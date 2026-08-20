import { prisma, Prisma } from "@bcwin/db";
import { SystemSettings } from "@bcwin/config";
import { getTotalUserBets } from "@/lib/utils";

export type WagerCategory = "RECHARGE" | "REWARD";

/** Inclusive. Float leftovers never hit exact 0 (ADR-0027). */
export const LOW_BALANCE_WAGER_CLEAR = 5;

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
        const baseWager = await SystemSettings.getWagerFactor();
        multiplier = user?.hasIllegalBetPenalty
            ? (user.illegalBetPenaltyFactor ?? 3.0)
            : baseWager;
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
 * 2. First-party + Inout stake (rolled-back Inout ignored).
 * 3. Categorized breakdown (Deposit Wager vs Reward Wager).
 */
export async function getUserWagerStatus(userId: string): Promise<UserWagerStatus> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { balance: true },
    });

    if (user && user.balance <= LOW_BALANCE_WAGER_CLEAR) {
        await checkAndResetZeroBalanceWager(userId, user.balance);
        return {
            depositWagerNeeded: 0,
            rewardWagerNeeded: 0,
            totalNeedToBet: 0,
            isWithdrawalFrozen: false,
            activeRequirementsCount: 0,
        };
    }

    const activeReqs = await prisma.wagerRequirement.findMany({
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
        });

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
            await prisma.wagerRequirement.update({
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
    currentBalance: number
) {
    if (currentBalance > LOW_BALANCE_WAGER_CLEAR) return;
    await prisma.wagerRequirement.updateMany({
        where: {
            userId,
            isCleared: false,
        },
        data: {
            isCleared: true,
        },
    });
}
