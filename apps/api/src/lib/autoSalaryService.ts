import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { WebSocketManager } from "@bcwin/websocket";
import { Cache, CacheKey } from "@bcwin/cache";
import { TeamMetricsCalculator } from "./teamMetricsCalculator";

const logger = new Logger("auto-salary");

// ============================================================================
// SLABS — highest fully met is paid
// ============================================================================

export type AutoSalarySlab = {
    reward: number;
    direct: number;
    active: number;
    teamDeposit: number;
};

/**
 * Ordered lowest → highest; matching uses reverse scan for highest fully met.
 * Rule: Highest Slab Fully Met Is Paid (INR).
 * Fields map to: directTeam · activeTeam · deposit (team) · salary (reward).
 */
export const AUTO_SALARY_SLABS: readonly AutoSalarySlab[] = [
    { reward: 300, direct: 2, active: 3, teamDeposit: 6_000 },
    { reward: 500, direct: 3, active: 6, teamDeposit: 10_000 },
    { reward: 800, direct: 5, active: 8, teamDeposit: 18_000 },
    { reward: 1_200, direct: 6, active: 12, teamDeposit: 30_000 },
    { reward: 2_000, direct: 7, active: 20, teamDeposit: 50_000 },
    { reward: 3_000, direct: 8, active: 50, teamDeposit: 80_000 },
    { reward: 4_500, direct: 10, active: 80, teamDeposit: 150_000 },
    { reward: 6_000, direct: 10, active: 120, teamDeposit: 200_000 },
    { reward: 10_000, direct: 12, active: 200, teamDeposit: 400_000 },
    { reward: 20_000, direct: 12, active: 400, teamDeposit: 1_000_000 },
    { reward: 50_000, direct: 15, active: 750, teamDeposit: 1_800_000 },
    { reward: 100_000, direct: 15, active: 1_500, teamDeposit: 3_000_000 },
] as const;

export type SalaryMetrics = {
    directCount: number;
    activeCount: number;
    teamDeposit: number;
};

export type SlabMatch = {
    amount: number;
    slabIndex: number;
    slab: AutoSalarySlab;
};

// ============================================================================
// DATE HELPERS (IST — match rest of salary / activity code)
// ============================================================================

const IST = "Asia/Kolkata";

/** Parse YYYY-MM-DD as IST calendar day → { start, end, periodDate } */
export function getIstDayRange(periodYmd: string): {
    start: Date;
    end: Date;
    periodDate: Date;
} {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodYmd)) {
        throw new Error("periodDate must be YYYY-MM-DD");
    }
    // IST midnight of that day through end of day
    const periodDate = new Date(`${periodYmd}T00:00:00+05:30`);
    const end = new Date(`${periodYmd}T23:59:59.999+05:30`);
    return { start: periodDate, end, periodDate };
}

export function formatIstYmd(d: Date): string {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: IST,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(d);
}

// ============================================================================
// SLAB MATCH
// ============================================================================

export function matchHighestSlab(metrics: SalaryMetrics): SlabMatch | null {
    for (let i = AUTO_SALARY_SLABS.length - 1; i >= 0; i--) {
        const slab = AUTO_SALARY_SLABS[i]!;
        if (
            metrics.directCount >= slab.direct &&
            metrics.activeCount >= slab.active &&
            metrics.teamDeposit >= slab.teamDeposit
        ) {
            return { amount: slab.reward, slabIndex: i, slab };
        }
    }
    return null;
}

// ============================================================================
// METRICS — demo users never count (team walker already filters isDemo:false)
// ============================================================================

/** Min total bet amount (₹) in the last 24h to count as an active member */
export const ACTIVE_MEMBER_MIN_BET = 150;
/** Lookback window for active-member betting */
export const ACTIVE_MEMBER_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Count non-demo team members whose total bet volume (all lottery games)
 * in [windowStart, windowEnd] is ≥ ACTIVE_MEMBER_MIN_BET.
 */
async function countActiveMembersByBet(
    teamUserIds: string[],
    windowStart: Date,
    windowEnd: Date
): Promise<number> {
    if (teamUserIds.length === 0) return 0;

    const betWhere = {
        userId: { in: teamUserIds },
        createdAt: { gte: windowStart, lte: windowEnd },
        user: { isDemo: false },
    };

    const [wingo, fiveD, k3, moto, trx] = await Promise.all([
        prisma.wingoBet.groupBy({
            by: ["userId"],
            where: betWhere,
            _sum: { betAmount: true },
        }),
        prisma.fiveDBet.groupBy({
            by: ["userId"],
            where: betWhere,
            _sum: { betAmount: true },
        }),
        prisma.k3Bet.groupBy({
            by: ["userId"],
            where: betWhere,
            _sum: { betAmount: true },
        }),
        prisma.motoBet.groupBy({
            by: ["userId"],
            where: betWhere,
            _sum: { betAmount: true },
        }),
        prisma.trxWingoBet.groupBy({
            by: ["userId"],
            where: betWhere,
            _sum: { betAmount: true },
        }),
    ]);

    const totals = new Map<string, number>();
    const add = (
        rows: { userId: string; _sum: { betAmount: number | null } }[]
    ) => {
        for (const r of rows) {
            totals.set(
                r.userId,
                (totals.get(r.userId) ?? 0) + (r._sum.betAmount ?? 0)
            );
        }
    };
    add(wingo);
    add(fiveD);
    add(k3);
    add(moto);
    add(trx);

    let count = 0;
    for (const sum of totals.values()) {
        if (sum >= ACTIVE_MEMBER_MIN_BET) count += 1;
    }
    return count;
}

/**
 * Direct = L1 non-demo invites.
 * Active = L1–L6 non-demo downline who bet ≥ ₹150 total in the last 24 hours
 *          (as-of dayEnd, or now if day is still open).
 * Team deposit = all-level non-demo downline SUCCESS deposits on the IST day.
 * Demo accounts in downline are never included.
 */
export async function computeUserSalaryMetrics(
    userId: string,
    dayStart: Date,
    dayEnd: Date
): Promise<SalaryMetrics> {
    const teamMembers = await TeamMetricsCalculator.getTeamMembers(userId, 6);
    // TeamMetricsCalculator already excludes isDemo:false only members
    const directIds = teamMembers
        .filter((m) => m.layer === 1)
        .map((m) => m.user.id);
    const allIds = teamMembers.map((m) => m.user.id);

    if (allIds.length === 0) {
        return { directCount: 0, activeCount: 0, teamDeposit: 0 };
    }

    // Active window: last 24h ending at now (live day) or at dayEnd (past day)
    const now = new Date();
    const activeEnd = dayEnd.getTime() < now.getTime() ? dayEnd : now;
    const activeStart = new Date(
        activeEnd.getTime() - ACTIVE_MEMBER_WINDOW_MS
    );

    const [activeCount, teamDepositAgg] = await Promise.all([
        countActiveMembersByBet(allIds, activeStart, activeEnd),
        prisma.deposit.aggregate({
            where: {
                userId: { in: allIds },
                status: "SUCCESS",
                createdAt: { gte: dayStart, lte: dayEnd },
                user: { isDemo: false },
            },
            _sum: { amount: true },
        }),
    ]);

    return {
        directCount: directIds.length,
        activeCount,
        teamDeposit: teamDepositAgg._sum.amount || 0,
    };
}

// ============================================================================
// GENERATE
// ============================================================================

export type GenerateResult = {
    periodDate: string;
    created: number;
    updated: number;
    skippedNoSlab: number;
    skippedApproved: number;
    evaluated: number;
};

export async function generateAutoSalaries(
    periodYmd: string
): Promise<GenerateResult> {
    const { start, end, periodDate } = getIstDayRange(periodYmd);

    // Candidate parents: non-demo users who have ≥1 non-demo direct invite
    const parentCodes = await prisma.user.findMany({
        where: {
            isDemo: false,
            referredBy: { not: null },
        },
        select: { referredBy: true },
        distinct: ["referredBy"],
    });

    const codes = parentCodes
        .map((r) => r.referredBy)
        .filter((c): c is string => !!c);

    const candidates =
        codes.length === 0
            ? []
            : await prisma.user.findMany({
                  where: {
                      isDemo: false,
                      referralCode: { in: codes },
                  },
                  select: { id: true },
              });

    let created = 0;
    let updated = 0;
    let skippedNoSlab = 0;
    let skippedApproved = 0;

    for (const candidate of candidates) {
        try {
            const metrics = await computeUserSalaryMetrics(
                candidate.id,
                start,
                end
            );
            const match = matchHighestSlab(metrics);
            if (!match) {
                skippedNoSlab++;
                continue;
            }

            const existing = await prisma.autoSalaryClaim.findUnique({
                where: {
                    userId_periodDate: {
                        userId: candidate.id,
                        periodDate,
                    },
                },
            });

            if (existing?.status === "APPROVED") {
                skippedApproved++;
                continue;
            }

            if (existing) {
                await prisma.autoSalaryClaim.update({
                    where: { id: existing.id },
                    data: {
                        amount: match.amount,
                        slabIndex: match.slabIndex,
                        directCount: metrics.directCount,
                        activeCount: metrics.activeCount,
                        teamDeposit: metrics.teamDeposit,
                        status: "PENDING",
                        reviewedById: null,
                        reviewedAt: null,
                        rejectReason: null,
                    },
                });
                updated++;
            } else {
                await prisma.autoSalaryClaim.create({
                    data: {
                        userId: candidate.id,
                        periodDate,
                        amount: match.amount,
                        slabIndex: match.slabIndex,
                        directCount: metrics.directCount,
                        activeCount: metrics.activeCount,
                        teamDeposit: metrics.teamDeposit,
                        status: "PENDING",
                    },
                });
                created++;
            }
        } catch (err) {
            logger.error(
                `generateAutoSalaries failed for user ${candidate.id}`,
                err
            );
        }
    }

    logger.info(
        `Auto salary generate ${periodYmd}: evaluated=${candidates.length} created=${created} updated=${updated} noSlab=${skippedNoSlab} approvedSkip=${skippedApproved}`
    );

    return {
        periodDate: periodYmd,
        created,
        updated,
        skippedNoSlab,
        skippedApproved,
        evaluated: candidates.length,
    };
}

// ============================================================================
// APPROVE / REJECT
// ============================================================================

export async function approveAutoSalaryClaim(
    claimId: string,
    adminId: string
): Promise<{ userId: string; amount: number; balance: number }> {
    const result = await prisma.$transaction(async (tx) => {
        const claim = await tx.autoSalaryClaim.findUnique({
            where: { id: claimId },
        });

        if (!claim) {
            throw new Error("Claim not found");
        }
        if (claim.status === "APPROVED") {
            throw new Error("Claim already approved");
        }
        if (claim.status === "REJECTED") {
            throw new Error("Claim was rejected — regenerate first");
        }

        // Guard: recipient must not be demo
        const recipient = await tx.user.findUnique({
            where: { id: claim.userId },
            select: { isDemo: true, balance: true },
        });
        if (!recipient || recipient.isDemo) {
            throw new Error("Cannot pay salary to demo account");
        }

        const updatedUser = await tx.user.update({
            where: { id: claim.userId },
            data: { balance: { increment: claim.amount } },
            select: { balance: true },
        });

        await tx.adminBalanceUpdateTransaction.create({
            data: {
                userId: claim.userId,
                byUserId: adminId,
                amount: claim.amount,
                reason: `Auto salary ${formatIstYmd(claim.periodDate)} slab ₹${claim.amount}`,
            },
        });

        await tx.autoSalaryClaim.update({
            where: { id: claimId },
            data: {
                status: "APPROVED",
                reviewedById: adminId,
                reviewedAt: new Date(),
                rejectReason: null,
            },
        });

        return {
            userId: claim.userId,
            amount: claim.amount,
            balance: updatedUser.balance,
        };
    });

    try {
        WebSocketManager.publishToUser(result.userId, "account-balance", {
            balance: result.balance,
        });
    } catch (err) {
        logger.error("Failed to publish balance after auto salary", err);
    }

    logger.info("Auto salary approved", {
        claimId,
        userId: result.userId,
        amount: result.amount,
        adminId,
    });

    // Bust user salary dashboard / history cache so panel + transactions update
    try {
        await Cache.del(`user:salary-dashboard:${result.userId}`);
        await Cache.del(CacheKey.userSalaryHistory(result.userId));
    } catch (err) {
        logger.error("Failed to clear salary cache after approve", err);
    }

    return result;
}

export async function rejectAutoSalaryClaim(
    claimId: string,
    adminId: string,
    reason?: string
): Promise<void> {
    const claim = await prisma.autoSalaryClaim.findUnique({
        where: { id: claimId },
    });

    if (!claim) {
        throw new Error("Claim not found");
    }
    if (claim.status === "APPROVED") {
        throw new Error("Cannot reject an already approved claim");
    }
    if (claim.status === "REJECTED") {
        return;
    }

    await prisma.autoSalaryClaim.update({
        where: { id: claimId },
        data: {
            status: "REJECTED",
            reviewedById: adminId,
            reviewedAt: new Date(),
            rejectReason: reason || null,
        },
    });

    logger.info("Auto salary rejected", { claimId, adminId });
}
