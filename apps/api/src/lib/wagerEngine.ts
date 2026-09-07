import { prisma, Prisma } from "@bcwin/db";
import { SystemSettings } from "@bcwin/config";
import { getTotalUserBets } from "@/lib/utils";

export type WagerCategory = "RECHARGE" | "REWARD";

/** Inclusive. Float leftovers never hit exact 0 (ADR-0027). */
export const LOW_BALANCE_WAGER_CLEAR = 5;

const DEFAULT_PENALTY_FACTOR = 1;

export function liveRechargeMultiplier(user: {
    hasIllegalBetPenalty: boolean;
    illegalBetPenaltyFactor: number | null;
    configWager: number;
    configPenalty?: number | null;
}): number {
    if (user.hasIllegalBetPenalty) {
        const userF = user.illegalBetPenaltyFactor;
        if (userF != null && userF > 0) return userF;
        const cfgF = user.configPenalty;
        return cfgF != null && cfgF > 0 ? cfgF : DEFAULT_PENALTY_FACTOR;
    }
    return user.configWager > 0 ? user.configWager : 1;
}

/**
 * Recharge wager follows the live admin factor (penalty or Config.wager).
 * Snapshot at deposit is only a starting value — raising 1x → 3x must reopen
 * remaining need, or 3x users withdraw after betting principal once.
 */
export async function syncRechargeWagerToLiveFactor(
    userId: string,
    liveMult: number,
    db: Prisma.TransactionClient | typeof prisma = prisma
) {
    if (!(liveMult > 0)) return;

    const reqs = await db.wagerRequirement.findMany({
        where: { userId, sourceType: "RECHARGE" },
    });

    for (const req of reqs) {
        const newRequired = Math.ceil(req.amount * liveMult);
        const factorUp = newRequired > req.requiredWager;
        if (
            newRequired === req.requiredWager &&
            req.multiplier === liveMult &&
            !factorUp
        ) {
            continue;
        }
        await db.wagerRequirement.update({
            where: { id: req.id },
            data: {
                multiplier: liveMult,
                requiredWager: newRequired,
                isCleared: factorUp ? false : req.isCleared,
            },
        });
    }
}

/**
 * Creates a wager requirement record for a deposit or reward claim.
 */
export async function createWagerRequirement(
    tx: Prisma.TransactionClient | typeof prisma,
    userId: string,
    sourceType: WagerCategory,
    amount: number,
    sourceId?: string
) {
    if (amount <= 0) return null;

    let multiplier = 1.0;

    if (sourceType === "RECHARGE") {
        const user = await tx.user.findUnique({
            where: { id: userId },
            select: { hasIllegalBetPenalty: true, illegalBetPenaltyFactor: true },
        });
        const config = await SystemSettings.get();
        multiplier = liveRechargeMultiplier({
            hasIllegalBetPenalty: user?.hasIllegalBetPenalty ?? false,
            illegalBetPenaltyFactor: user?.illegalBetPenaltyFactor ?? null,
            configWager: config?.wager ?? 1,
            configPenalty: config?.illegalBetPenaltyFactor ?? DEFAULT_PENALTY_FACTOR,
        });
    } else if (sourceType === "REWARD") {
        const sysConfig = await SystemSettings.get();
        multiplier = (sysConfig as any)?.rewardWagerFactor ?? 1.0;
    }

    const requiredWager = Math.ceil(amount * multiplier);

    return tx.wagerRequirement.create({
        data: {
            userId,
            sourceType: sourceType as any,
            sourceId: sourceId || null,
            amount,
            multiplier,
            requiredWager,
            wagerCleared: 0,
            isCleared: requiredWager <= 0,
        },
    });
}

export interface UserWagerStatus {
    depositWagerNeeded: number;
    rewardWagerNeeded: number;
    totalNeedToBet: number;
    isWithdrawalFrozen: boolean;
    activeRequirementsCount: number;
}

/**
 * Computes active wager requirements for a user, enforcing:
 * 1. Timestamp-based clearing (bets placed at/after item creation).
 * 2. First-party stake only (third-party Inout bets excluded).
 * 3. Categorized breakdown (Deposit Wager vs Reward Wager).
 */
export async function getUserWagerStatus(
    userId: string,
    tx?: Prisma.TransactionClient
): Promise<UserWagerStatus> {
    if (!tx) {
        return prisma.$transaction(async (db) => {
            await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
            return getUserWagerStatus(userId, db);
        });
    }
    const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
            balance: true,
            hasIllegalBetPenalty: true,
            illegalBetPenaltyFactor: true,
            zeroWagerEnabled: true,
            zeroWagerConsumedAt: true,
        },
    });

    // The override hides requirements without clearing or rescaling them.
    if (user?.zeroWagerEnabled) {
        return {
            depositWagerNeeded: 0,
            rewardWagerNeeded: 0,
            totalNeedToBet: 0,
            isWithdrawalFrozen: false,
            activeRequirementsCount: 0,
        };
    }

    // Withdrawing the wallet must not erase the wager restored by this override.
    // Ordinary low-balance clearing resumes once the user places another bet.
    const preserveAfterWithdrawal = user?.zeroWagerConsumedAt &&
        user.balance <= LOW_BALANCE_WAGER_CLEAR &&
        await getTotalUserBets(userId, { since: user.zeroWagerConsumedAt }, tx) === 0;
    if (user && user.balance <= LOW_BALANCE_WAGER_CLEAR && !preserveAfterWithdrawal) {
        await checkAndResetZeroBalanceWager(userId, user.balance, tx);
        return {
            depositWagerNeeded: 0,
            rewardWagerNeeded: 0,
            totalNeedToBet: 0,
            isWithdrawalFrozen: false,
            activeRequirementsCount: 0,
        };
    }

    if (user) {
        const config = await SystemSettings.get();
        await syncRechargeWagerToLiveFactor(
            userId,
            liveRechargeMultiplier({
                hasIllegalBetPenalty: user.hasIllegalBetPenalty,
                illegalBetPenaltyFactor: user.illegalBetPenaltyFactor,
                configWager: config?.wager ?? 1,
                configPenalty: config?.illegalBetPenaltyFactor ?? DEFAULT_PENALTY_FACTOR,
            }),
            tx
        );
    }

    const activeReqs = await tx.wagerRequirement.findMany({
        where: {
            userId,
            isCleared: false,
        },
        orderBy: {
            createdAt: "asc",
        },
    });

    if (activeReqs.length === 0) {
        return {
            depositWagerNeeded: 0,
            rewardWagerNeeded: 0,
            totalNeedToBet: 0,
            isWithdrawalFrozen: false,
            activeRequirementsCount: 0,
        };
    }

    let depositWagerNeeded = 0;
    let rewardWagerNeeded = 0;

    for (let i = 0; i < activeReqs.length; i++) {
        const req = activeReqs[i];

        const totalBetsSince = await getTotalUserBets(userId, {
            since: req.createdAt,
            excludeInout: true,
        }, tx);

        // Subtract bets consumed by earlier active requirements
        let priorConsumedBets = 0;
        for (let j = 0; j < i; j++) {
            const prior = activeReqs[j];
            if (prior.createdAt >= req.createdAt) {
                priorConsumedBets += prior.requiredWager;
            }
        }

        const availableBets = Math.max(0, totalBetsSince - priorConsumedBets);

        if (availableBets >= req.requiredWager) {
            await tx.wagerRequirement.update({
                where: { id: req.id },
                data: {
                    isCleared: true,
                    wagerCleared: req.requiredWager,
                },
            });
        } else {
            const needed = Math.ceil(req.requiredWager - availableBets);
            if (req.sourceType === "RECHARGE") {
                depositWagerNeeded += needed;
            } else {
                rewardWagerNeeded += needed;
            }
        }
    }

    const totalNeedToBet = depositWagerNeeded + rewardWagerNeeded;

    return {
        depositWagerNeeded,
        rewardWagerNeeded,
        totalNeedToBet,
        isWithdrawalFrozen: totalNeedToBet > 0,
        activeRequirementsCount: activeReqs.length,
    };
}

/**
 * Clears every open wager (RECHARGE + REWARD) when wallet is ≤ ₹5.
 * Leftover rupees stay; withdraw is allowed; next recharge starts a new row.
 */
export async function checkAndResetZeroBalanceWager(
    userId: string,
    currentBalance: number,
    db: Prisma.TransactionClient | typeof prisma = prisma
) {
    if (currentBalance > LOW_BALANCE_WAGER_CLEAR) return;
    await db.wagerRequirement.updateMany({
        where: {
            userId,
            isCleared: false,
        },
        data: {
            isCleared: true,
        },
    });
}
