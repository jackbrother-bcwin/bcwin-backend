import { prisma, type Prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";

export type IllegalBetGame = "WINGO" | "TRXWINGO" | "5D" | "K3" | "MOTO";
type Bet = { id: string; userId: string; periodId: string; betAmount: number; betChoice: string };
const opposites: Record<string, string> = {
    RED: "GREEN", GREEN: "RED", BIG: "SMALL", SMALL: "BIG",
    ODD: "EVEN", EVEN: "ODD", LOW: "HIGH", HIGH: "LOW",
};

/** The caller holds the user's row lock, including when called during placement. */
export async function applyIllegalRoundPenalty(
    tx: Prisma.TransactionClient,
    game: IllegalBetGame,
    bets: Bet[]
) {
    const first = bets[0];
    if (!first || bets.length < 2) return false;
    const allowed = game === "5D" ? ["LOW", "HIGH", "ODD", "EVEN"]
        : game === "WINGO" || game === "TRXWINGO" ? ["RED", "GREEN", "BIG", "SMALL"]
        : ["BIG", "SMALL", "ODD", "EVEN"];
    const roundPrefix = `${game}:${first.periodId}:${first.userId}:`;
    const records: Prisma.IllegalBetCreateManyInput[] = [];
    for (let i = 0; i < bets.length; i++) {
        const a = bets[i];
        if (!allowed.includes(a.betChoice)) continue;
        for (let j = i + 1; j < bets.length; j++) {
            const b = bets[j];
            if (a.betAmount !== b.betAmount || opposites[a.betChoice] !== b.betChoice) continue;
            records.push({
                userId: first.userId, betAmount: a.betAmount, betGame: game,
                betType: `${a.betChoice}_${b.betChoice}`,
                penaltyEventKey: roundPrefix + [a.id, b.id].sort().join(":"),
            });
        }
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
    await tx.user.update({
        where: { id: first.userId },
        data: { hasIllegalBetPenalty: true, illegalBetPenaltyFactor: factor },
    });
    return true;
}

export async function detectPlacedIllegalBet(tx: Prisma.TransactionClient, game: IllegalBetGame, bet: Bet) {
    const args = {
        where: { userId: bet.userId, periodId: bet.periodId },
        select: { id: true, userId: true, periodId: true, betAmount: true, betChoice: true },
    };
    let bets: Bet[];
    switch (game) {
        case "WINGO": bets = await tx.wingoBet.findMany(args); break;
        case "TRXWINGO": bets = await tx.trxWingoBet.findMany(args); break;
        case "5D": bets = await tx.fiveDBet.findMany(args); break;
        case "K3": bets = await tx.k3Bet.findMany(args); break;
        case "MOTO": bets = await tx.motoBet.findMany(args); break;
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
    for (const group of groups.values()) {
        const userId = group[0].userId;
        const changed = await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
            return applyIllegalRoundPenalty(tx, game, group);
        });
        if (changed) await invalidatePenaltyCache(userId);
    }
}
