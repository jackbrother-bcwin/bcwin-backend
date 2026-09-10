import { prisma, type Prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import Logger from "@bcwin/logger";
import { findFullNumberCoverage, isIllegalBetPair, type IllegalBetGame, type IllegalBetInput } from "./rules";
import {
    comparePenaltyWager,
    liveRechargeMultiplier,
    replaceBalancePenaltySnapshot,
    syncRechargeWagerToLiveFactor,
    WAGER_TRANSACTION_TIMEOUT_MS,
} from "@bcwin/wager";
import { penaltyHistoryAmounts, roundPeriodNumber } from "@bcwin/wager/penaltyHistory";

export type { IllegalBetGame } from "./rules";
type Bet = IllegalBetInput;
const logger = new Logger("illegal-bets");

/** The caller holds the user's row lock, including when called during placement. */
export async function applyIllegalRoundPenalty(
    tx: Prisma.TransactionClient,
    game: IllegalBetGame,
    bets: Bet[]
) {
    const first = bets[0];
    if (!first || bets.length < 2) return false;
    const roundPrefix = `${game}:${first.periodId}:${first.userId}:`;
    const records: Prisma.IllegalBetCreateManyInput[] = [];
    const triggeringBets = new Map<string, Bet>();
    for (let i = 0; i < bets.length; i++) {
        const a = bets[i];
        for (let j = i + 1; j < bets.length; j++) {
            const b = bets[j];
            if (!isIllegalBetPair(game, a, b)) continue;
            triggeringBets.set(a.id, a);
            triggeringBets.set(b.id, b);
            records.push({
                userId: first.userId, betAmount: a.betAmount, betGame: game,
                betType: `${a.betChoice}_${b.betChoice}`,
                penaltyEventKey: roundPrefix + [a.id, b.id].sort().join(":"),
            });
        }
    }
    for (const coverage of findFullNumberCoverage(game, bets)) {
        for (const bet of coverage.bets) triggeringBets.set(bet.id, bet);
        records.push({
            userId: first.userId, betAmount: coverage.bets[0].betAmount, betGame: game,
            betType: `${coverage.scope}_ALL_NUMBERS`,
            penaltyEventKey: roundPrefix + "coverage:" + coverage.bets.map((bet) => bet.id).sort().join(":"),
        });
    }
    if (!records.length) return false;

    // Preserve pair-level reporting, but increase the penalty once per round.
    const alreadyPenalized = await tx.illegalBet.findFirst({
        where: { userId: first.userId, penaltyEventKey: { startsWith: roundPrefix } },
        select: { id: true },
    });
    const inserted = await tx.illegalBet.createMany({
        data: records,
        skipDuplicates: true,
    });
    if (alreadyPenalized || !inserted.count) return false;
    const user = await tx.user.findUniqueOrThrow({ where: { id: first.userId } });
    const config = await tx.config.findFirst();
    const base = config?.illegalBetPenaltyFactor ?? 3;
    const current = user.hasIllegalBetPenalty ? (user.illegalBetPenaltyFactor ?? base) : 1;
    // Keep the Float-backed multiplier within exact integer representation.
    const factor = Math.min(Number.MAX_SAFE_INTEGER, current * base);
    const next = { hasIllegalBetPenalty: true as const, illegalBetPenaltyFactor: factor };
    const comparison = await comparePenaltyWager(tx, first.userId, user, config, next);
    const history = await tx.penaltyHistoryEvent.create({ data: {
        userId: first.userId,
        eventKey: roundPrefix,
        action: "APPLIED",
        createdAt: new Date(),
        reason: "ILLEGAL_BETS",
        game,
        periodNumber: await roundPeriodNumber(tx, game, first.periodId),
        evidence: [...triggeringBets.values()].map((bet) => ({
            id: bet.id, selection: bet.betChoice, betType: bet.betType,
            amount: bet.betAmount,
            scope: bet.position ?? bet.targetPosition ?? bet.betCategory ?? null,
        })),
        ...penaltyHistoryAmounts(comparison.previousFactor, comparison.resultingFactor,
            comparison.before, comparison.after),
    } });
    await tx.user.update({
        where: { id: first.userId },
        data: {
            hasIllegalBetPenalty: true,
            illegalBetPenaltyFactor: factor,
            penaltyWagerModel: "BALANCE_SNAPSHOT",
        },
    });
    await syncRechargeWagerToLiveFactor(
        first.userId,
        liveRechargeMultiplier({
            hasIllegalBetPenalty: true,
            illegalBetPenaltyFactor: factor,
            penaltyWagerModel: "BALANCE_SNAPSHOT",
            configWager: config?.wager ?? 1,
            configPenalty: config?.illegalBetPenaltyFactor,
        }),
        tx
    );
    await replaceBalancePenaltySnapshot(tx, first.userId, user.balance, factor, history.id);
    return true;
}

export async function detectPlacedIllegalBet(tx: Prisma.TransactionClient, game: IllegalBetGame, bet: Bet) {
    const args = {
        where: { userId: bet.userId, periodId: bet.periodId },
        select: { id: true, userId: true, periodId: true, betAmount: true, betType: true, betChoice: true },
    };
    let bets: Bet[];
    switch (game) {
        case "WINGO": bets = await tx.wingoBet.findMany(args); break;
        case "TRXWINGO": bets = await tx.trxWingoBet.findMany(args); break;
        case "5D": bets = await tx.fiveDBet.findMany({
            ...args, select: { ...args.select, betCategory: true, position: true },
        }); break;
        case "K3": bets = await tx.k3Bet.findMany(args); break;
        case "MOTO": bets = await tx.motoBet.findMany({
            ...args, select: { ...args.select, targetPosition: true },
        }); break;
    }
    return applyIllegalRoundPenalty(tx, game, bets);
}

export async function invalidatePenaltyCache(userId: string) {
    await Promise.all([Cache.del(CacheKey.adminUserStats(userId)), Cache.del(CacheKey.adminUsers)]);
}

/** Settlement also covers bets accepted by an older API during deployment. */
export async function detectSettledIllegalBets(game: IllegalBetGame, bets: Bet[]) {
    const groups = new Map<string, Bet[]>();
    for (const bet of bets) {
        const key = `${bet.userId}:${bet.periodId}`;
        const group = groups.get(key) ?? [];
        group.push(bet);
        groups.set(key, group);
    }
    // Isolate each user/round so one snapshot/DB failure cannot abort the whole settle tick.
    for (const group of groups.values()) {
        const userId = group[0].userId;
        const periodId = group[0].periodId;
        try {
            const changed = await prisma.$transaction(async (tx) => {
                await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
                return applyIllegalRoundPenalty(tx, game, group);
            }, { timeout: WAGER_TRANSACTION_TIMEOUT_MS });
            if (changed) await invalidatePenaltyCache(userId);
        } catch (error) {
            logger.error(`Settlement penalty failed for ${game} user=${userId} period=${periodId}`, error);
        }
    }
}
