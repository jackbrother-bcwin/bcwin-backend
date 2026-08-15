import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { SystemSettings } from "@bcwin/config";

const logger = new Logger("activity-bonus-service");

// ============================================================================
// TIER CONFIGURATIONS
// ============================================================================

/**
 * Weekly slot-bet volume tiers (rolling 7 days).
 * Bet requirements doubled (client pause period); re-check when re-enabling weekly bonus.
 */
export const FALLBACK_WEEKLY_TIERS = [
    { requirement: 20000, reward: 25 },
    { requirement: 40000, reward: 50 },
    { requirement: 100000, reward: 200 },
    { requirement: 200000, reward: 500 },
    { requirement: 300000, reward: 700 },
    { requirement: 600000, reward: 1500 },
];

/** Applied to DB ActivityBonusTier WEEKLY betRequirement until admin data is updated. */
export const WEEKLY_REQUIREMENT_SCALE = 2;

/**
 * TEMP: weekly bonus accrual disabled until client asks to re-enable.
 * Flip to true and restore call sites if needed.
 */
export const WEEKLY_BONUS_ENABLED = false;

export const FALLBACK_DAILY_TIERS = [
    { deposit: 100, bet: 300, reward: 8 },
    { deposit: 300, bet: 900, reward: 18 },
    { deposit: 500, bet: 1500, reward: 38 },
    { deposit: 1000, bet: 3000, reward: 88 },
    { deposit: 3000, bet: 9000, reward: 288 },
];

/**
 * Invitation bonus tiers — client Invitation Rules table (product).
 * Keep in sync with FE `INVITATION_RULES_TABLE` in activity/catalog.ts.
 * L1 invites only; each invitee total SUCCESS deposit ≥ minDeposit.
 * Admin ActivityBonusTier type=INVITATION overrides when present.
 */
export const FALLBACK_INVITATION_TIERS = [
    { invites: 1, minDeposit: 200, reward: 27 },
    { invites: 3, minDeposit: 300, reward: 157 },
    { invites: 10, minDeposit: 500, reward: 577 },
    { invites: 30, minDeposit: 800, reward: 1577 },
    { invites: 60, minDeposit: 1200, reward: 3577 },
    { invites: 100, minDeposit: 1200, reward: 5777 },
    { invites: 200, minDeposit: 1200, reward: 10777 },
    { invites: 500, minDeposit: 1200, reward: 20777 },
    { invites: 1000, minDeposit: 1200, reward: 50777 },
    { invites: 2000, minDeposit: 1200, reward: 107777 },
    { invites: 5000, minDeposit: 1500, reward: 307777 },
    { invites: 10000, minDeposit: 1500, reward: 507777 },
    { invites: 20000, minDeposit: 1500, reward: 777777 },
];

/**
 * First deposit tiers: ₹300 → ₹100,000.
 * User receives only the highest tier their first SUCCESS deposit qualifies for.
 * Admin DB rows (type FIRST_DEPOSIT) override this when present.
 */
export const FALLBACK_FIRST_DEPOSIT_TIERS = [
    { requirement: 300, reward: 28 },
    { requirement: 500, reward: 58 },
    { requirement: 1000, reward: 108 },
    { requirement: 3000, reward: 188 },
    { requirement: 5000, reward: 288 },
    { requirement: 10000, reward: 588 },
    { requirement: 30000, reward: 1288 },
    { requirement: 50000, reward: 1888 },
    { requirement: 100000, reward: 3888 },
];

export const FALLBACK_ATTENDANCE_TIERS = [
    { day: 1, accumulatedDeposit: 100, reward: 2 },
    { day: 2, accumulatedDeposit: 300, reward: 3 },
    { day: 3, accumulatedDeposit: 500, reward: 5 },
    { day: 4, accumulatedDeposit: 800, reward: 8 },
    { day: 5, accumulatedDeposit: 1500, reward: 18 },
    { day: 6, accumulatedDeposit: 3000, reward: 38 },
    { day: 7, accumulatedDeposit: 5000, reward: 58 },
];

// Expiration durations in days
export const EXPIRATION_DAYS = {
    DAILY: 1,
    ATTENDENCE: 1, // Note: ATTENDENCE matches the enum typo in schema
    WEEKLY: 7,
    INVITATION: 7,
    FIRST_DEPOSIT: 7,
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get total deposits for a user within a date range
 */
export async function getUserTotalDeposits(
    userId: string,
    startDate?: Date,
    endDate?: Date
): Promise<number> {
    const whereClause: any = {
        userId,
        status: "SUCCESS",
    };

    if (startDate || endDate) {
        whereClause.createdAt = {};
        if (startDate) whereClause.createdAt.gte = startDate;
        if (endDate) whereClause.createdAt.lte = endDate;
    }

    const result = await prisma.deposit.aggregate({
        where: whereClause,
        _sum: { amount: true },
    });

    return result._sum.amount || 0;
}

/**
 * Get total slot bets for a user within a date range
 */
export async function getTotalUserSlotBetsInRange(
    userId: string,
    startDate: Date,
    endDate: Date
): Promise<number> {
    const whereClause = {
        userId,
        createdAt: {
            gte: startDate,
            lte: endDate,
        },
    };

    const [wingoBets, fiveDBets, k3Bets, motoBets, trxWingoBets, inoutBets] =
        await Promise.all([
            prisma.wingoBet.aggregate({
                where: whereClause,
                _sum: { betAmount: true },
            }),
            prisma.fiveDBet.aggregate({
                where: whereClause,
                _sum: { betAmount: true },
            }),
            prisma.k3Bet.aggregate({
                where: whereClause,
                _sum: { betAmount: true },
            }),
            prisma.motoBet.aggregate({
                where: whereClause,
                _sum: { betAmount: true },
            }),
            prisma.trxWingoBet.aggregate({
                where: whereClause,
                _sum: { betAmount: true },
            }),
            prisma.inoutBet.aggregate({
                where: whereClause,
                _sum: { betAmount: true },
            }),
        ]);

    return (
        (wingoBets._sum.betAmount || 0) +
        (fiveDBets._sum.betAmount || 0) +
        (k3Bets._sum.betAmount || 0) +
        (motoBets._sum.betAmount || 0) +
        (trxWingoBets._sum.betAmount || 0) +
        (inoutBets._sum.betAmount || 0)
    );
}

/**
 * Get count of invited users who have deposited at least minDeposit
 */
export async function getUserInvitedUsersWithDeposits(
    userId: string,
    minDeposit: number
): Promise<number> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { referralCode: true },
    });

    if (!user) return 0;

    // Find all users referred by this user
    const referredUsers = await prisma.user.findMany({
        where: { referredBy: user.referralCode },
        select: { id: true },
    });

    if (referredUsers.length === 0) return 0;

    // Count how many have deposited >= minDeposit
    const usersWithDeposits = await prisma.deposit.groupBy({
        by: ["userId"],
        where: {
            userId: { in: referredUsers.map((u) => u.id) },
            status: "SUCCESS",
        },
        _sum: { amount: true },
        having: {
            amount: {
                _sum: {
                    gte: minDeposit,
                },
            },
        },
    });

    return usersWithDeposits.length;
}

/**
 * Check if a bonus tier already exists for the user
 */
async function bonusTierExists(
    userId: string,
    type: string,
    tier: number
): Promise<boolean> {
    const existing = await prisma.activityBonus.findFirst({
        where: {
            userId,
            type: type as any,
            metadata: {
                path: ["tier"],
                equals: tier,
            },
        },
    });

    return !!existing;
}

/**
 * Calculate expiration date based on bonus type
 */
function calculateExpirationDate(type: string): Date {
    const now = new Date();
    const days = EXPIRATION_DAYS[type as keyof typeof EXPIRATION_DAYS] || 7;
    return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

// ============================================================================
// WEEKLY BONUS
// ============================================================================

/**
 * Unlock weekly activity bonuses when 7-day betting hits tier thresholds.
 * DISABLED: WEEKLY_BONUS_ENABLED === false (no new rows). Uncomment usage + set flag true later.
 */
export async function checkAndCreateWeeklyBonuses(
    userId: string
): Promise<void> {
    // --- weekly bonus paused (client) — remove this early-return to re-enable ---
    if (!WEEKLY_BONUS_ENABLED) {
        return;
    }
    // ---------------------------------------------------------------------------

    try {
        // Calculate 7-day rolling window
        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

        const totalBets = await getTotalUserSlotBetsInRange(
            userId,
            startDate,
            endDate
        );

        // Fetch dynamic weekly tiers
        const dbTiers = await prisma.activityBonusTier.findMany({
            where: { type: "WEEKLY" },
            orderBy: { betRequirement: "asc" },
        });

        const tiersToUse =
            dbTiers.length > 0
                ? dbTiers.map((t) => ({
                      requirement:
                          (t.betRequirement || 0) * WEEKLY_REQUIREMENT_SCALE,
                      reward: t.reward,
                  }))
                : FALLBACK_WEEKLY_TIERS;

        // Check each tier
        for (let i = 0; i < tiersToUse.length; i++) {
            const tier = tiersToUse[i];

            if (totalBets >= tier.requirement) {
                // Check if this tier bonus already exists
                if (await bonusTierExists(userId, "WEEKLY", i)) {
                    continue;
                }

                // Create new bonus
                await prisma.activityBonus.create({
                    data: {
                        userId,
                        type: "WEEKLY",
                        status: "COMPLETED_UNCOLLECTED",
                        amount: tier.reward,
                        expiresAt: calculateExpirationDate("WEEKLY"),
                        metadata: {
                            tier: i,
                            requirement: tier.requirement,
                            achieved: totalBets,
                        },
                    },
                });

                logger.debug(
                    `Created weekly bonus tier ${i} for user ${userId}: ${tier.reward}`
                );
            }
        }
    } catch (error) {
        logger.error("Error in checkAndCreateWeeklyBonuses:", error);
    }
}

// ============================================================================
// DAILY BONUS
// ============================================================================

export async function checkAndCreateDailyBonuses(
    userId: string
): Promise<void> {
    try {
        // Calculate today's boundaries (UTC)
        const now = new Date();
        const startOfDay = new Date(now);
        startOfDay.setUTCHours(0, 0, 0, 0);
        const endOfDay = new Date(now);
        endOfDay.setUTCHours(23, 59, 59, 999);

        // Get today's deposits and bets
        const [totalDeposits, totalBets] = await Promise.all([
            getUserTotalDeposits(userId, startOfDay, endOfDay),
            getTotalUserSlotBetsInRange(userId, startOfDay, endOfDay),
        ]);

        // Fetch dynamic daily tiers
        const dbTiers = await prisma.activityBonusTier.findMany({
            where: { type: "DAILY" },
            orderBy: [{ depositRequirement: "asc" }, { betRequirement: "asc" }],
        });

        const tiersToUse = dbTiers.length > 0
            ? dbTiers.map(t => ({ deposit: t.depositRequirement || 0, bet: t.betRequirement || 0, reward: t.reward }))
            : FALLBACK_DAILY_TIERS;

        // Check each tier
        for (let i = 0; i < tiersToUse.length; i++) {
            const tier = tiersToUse[i];

            if (totalDeposits >= tier.deposit && totalBets >= tier.bet) {
                // Check if this tier bonus already exists for today
                const existing = await prisma.activityBonus.findFirst({
                    where: {
                        userId,
                        type: "DAILY",
                        metadata: {
                            path: ["tier"],
                            equals: i,
                        },
                        createdAt: {
                            gte: startOfDay,
                            lte: endOfDay,
                        },
                    },
                });

                if (existing) {
                    continue;
                }

                // Create new bonus
                await prisma.activityBonus.create({
                    data: {
                        userId,
                        type: "DAILY",
                        status: "COMPLETED_UNCOLLECTED",
                        amount: tier.reward,
                        expiresAt: calculateExpirationDate("DAILY"),
                        metadata: {
                            tier: i,
                            requirement: {
                                deposit: tier.deposit,
                                slotBet: tier.bet,
                            },
                            achieved: {
                                deposit: totalDeposits,
                                slotBet: totalBets,
                            },
                        },
                    },
                });

                logger.debug(
                    `Created daily bonus tier ${i} for user ${userId}: ${tier.reward}`
                );
            }
        }
    } catch (error) {
        logger.error("Error in checkAndCreateDailyBonuses:", error);
    }
}

// ============================================================================
// INVITATION BONUS
// ============================================================================

export async function checkAndCreateInvitationBonuses(
    userId?: string
): Promise<void> {
    try {
        let userIds: string[];

        if (userId) {
            userIds = [userId];
        } else {
            // Get all users who have referred someone
            const users = await prisma.user.findMany({
                where: {
                    referralCode: {
                        in: await prisma.user
                            .findMany({
                                where: {
                                    referredBy: { not: null },
                                },
                                select: { referredBy: true },
                                distinct: ["referredBy"],
                            })
                            .then(
                                (users) =>
                                    users
                                        .map((u) => u.referredBy)
                                        .filter((r) => r !== null) as string[]
                            ),
                    },
                },
                select: { id: true },
            });

            userIds = users.map((u) => u.id);
        }

        const dbTiers = await prisma.activityBonusTier.findMany({
            where: { type: "INVITATION" },
            orderBy: [{ inviteRequirement: "asc" }, { depositRequirement: "asc" }],
        });

        const tiersToUse = dbTiers.length > 0
            ? dbTiers.map(t => ({ invites: t.inviteRequirement || 1, minDeposit: t.depositRequirement || 0, reward: t.reward }))
            : FALLBACK_INVITATION_TIERS;

        for (const uid of userIds) {
            // Check each tier
            for (let i = 0; i < tiersToUse.length; i++) {
                const tier = tiersToUse[i];

                const invitedCount = await getUserInvitedUsersWithDeposits(
                    uid,
                    tier.minDeposit
                );

                if (invitedCount >= tier.invites) {
                    // Check if this tier bonus already exists
                    if (await bonusTierExists(uid, "INVITATION", i)) {
                        continue;
                    }

                    // Create new bonus
                    await prisma.activityBonus.create({
                        data: {
                            userId: uid,
                            type: "INVITATION",
                            status: "COMPLETED_UNCOLLECTED",
                            amount: tier.reward,
                            expiresAt: calculateExpirationDate("INVITATION"),
                            metadata: {
                                tier: i,
                                requirement: {
                                    invites: tier.invites,
                                    minDeposit: tier.minDeposit,
                                },
                                achieved: invitedCount,
                            },
                        },
                    });

                    logger.debug(
                        `Created invitation bonus tier ${i} for user ${uid}: ${tier.reward}`
                    );
                }
            }
        }
    } catch (error) {
        logger.error("Error in checkAndCreateInvitationBonuses:", error);
    }
}

// ============================================================================
// FIRST DEPOSIT BONUS
// ============================================================================

export async function checkAndCreateFirstDepositBonus(
    userId: string,
    depositAmount: number
): Promise<void> {
    try {
        // Check if user already has a first deposit bonus
        const existingBonus = await prisma.activityBonus.findFirst({
            where: {
                userId,
                type: "FIRST_DEPOSIT",
            },
        });

        if (existingBonus) {
            return; // Already received first deposit bonus
        }

        // Check if this is actually the first successful deposit
        const depositCount = await prisma.deposit.count({
            where: {
                userId,
                status: "SUCCESS",
            },
        });

        if (depositCount !== 1) {
            return; // Not the first deposit
        }

        const dbTiers = await prisma.activityBonusTier.findMany({
            where: { type: "FIRST_DEPOSIT" },
            orderBy: { depositRequirement: "asc" },
        });

        const tiersToUse = dbTiers.length > 0
            ? dbTiers.map(t => ({ requirement: t.depositRequirement || 0, reward: t.reward }))
            : FALLBACK_FIRST_DEPOSIT_TIERS;

        // Find the highest tier that the deposit qualifies for
        let qualifyingTier = -1;
        let maxReward = 0;

        for (let i = 0; i < tiersToUse.length; i++) {
            const tier = tiersToUse[i];
            if (depositAmount >= tier.requirement) {
                qualifyingTier = i;
                maxReward = tier.reward;
            }
        }

        if (qualifyingTier >= 0) {
            await prisma.activityBonus.create({
                data: {
                    userId,
                    type: "FIRST_DEPOSIT",
                    status: "COMPLETED_UNCOLLECTED",
                    amount: maxReward,
                    expiresAt: calculateExpirationDate("FIRST_DEPOSIT"),
                    metadata: {
                        tier: qualifyingTier,
                        requirement: tiersToUse[qualifyingTier].requirement,
                        achieved: depositAmount,
                    },
                },
            });

            logger.debug(
                `Created first deposit bonus tier ${qualifyingTier} for user ${userId}: ${maxReward}`
            );
        }
    } catch (error) {
        logger.error("Error in checkAndCreateFirstDepositBonus:", error);
    }
}

// ============================================================================
// ATTENDANCE BONUS (daily login streak)
// ============================================================================

const ATTENDANCE_TZ = "Asia/Kolkata";

/** Calendar date key in IST (YYYY-MM-DD) — used for consecutive-day checks */
function istDateKey(d: Date): string {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: ATTENDANCE_TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(d);
}

/** Whole calendar days between two timestamps in IST (0 = same day) */
function istDayDiff(from: Date, to: Date): number {
    const a = new Date(`${istDateKey(from)}T00:00:00+05:30`).getTime();
    const b = new Date(`${istDateKey(to)}T00:00:00+05:30`).getTime();
    return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

/**
 * Update consecutive login streak for a user (IST calendar days).
 * Same day → no-op. Next day → streak+1. Gap → reset to 1.
 */
export async function updateLoginStreak(userId: string): Promise<number> {
    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { lastLoginDate: true, loginStreak: true },
        });

        if (!user) return 0;

        const now = new Date();
        let newStreak = 1;

        if (user.lastLoginDate) {
            const diffDays = istDayDiff(user.lastLoginDate, now);

            if (diffDays === 0) {
                // Already counted today
                return user.loginStreak;
            } else if (diffDays === 1) {
                newStreak = (user.loginStreak || 0) + 1;
            }
            // else: streak broken → 1
        }

        await prisma.user.update({
            where: { id: userId },
            data: {
                lastLoginDate: now,
                loginStreak: newStreak,
            },
        });

        logger.debug(
            `Updated login streak for user ${userId}: ${newStreak} (IST day)`
        );

        return newStreak;
    } catch (error) {
        logger.error("Error in updateLoginStreak:", error);
        return 0;
    }
}

export async function checkAndCreateAttendanceBonus(
    userId: string
): Promise<void> {
    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { loginStreak: true },
        });

        if (!user) return;

        const streak = user.loginStreak;
        if (!streak || streak < 1) return;

        const dbTiers = await prisma.activityBonusTier.findMany({
            where: { type: "ATTENDENCE" },
            orderBy: { dayRequirement: "asc" },
        });

        const tiersToUse =
            dbTiers.length > 0
                ? dbTiers.map((t) => ({
                    day: t.dayRequirement || 1,
                    accumulatedDeposit: t.depositRequirement || 0,
                    reward: t.reward,
                }))
                : FALLBACK_ATTENDANCE_TIERS;

        // Create bonuses for every tier the streak unlocks (not only exact day match)
        // so catching up after deposit still works for lower days if missing.
        const totalDeposits = await getUserTotalDeposits(userId);

        for (let tierIndex = 0; tierIndex < tiersToUse.length; tierIndex++) {
            const tier = tiersToUse[tierIndex]!;
            if (streak < tier.day) continue;
            if (totalDeposits < tier.accumulatedDeposit) continue;

            const existing = await prisma.activityBonus.findFirst({
                where: {
                    userId,
                    type: "ATTENDENCE", // Note: typo matches schema enum
                    metadata: {
                        path: ["tier"],
                        equals: tierIndex,
                    },
                },
            });

            if (existing) continue;

            await prisma.activityBonus.create({
                data: {
                    userId,
                    type: "ATTENDENCE",
                    status: "COMPLETED_UNCOLLECTED",
                    amount: tier.reward,
                    expiresAt: calculateExpirationDate("ATTENDENCE"),
                    metadata: {
                        tier: tierIndex,
                        requirement: {
                            day: tier.day,
                            accumulatedDeposit: tier.accumulatedDeposit,
                        },
                        achieved: {
                            day: streak,
                            accumulatedDeposit: totalDeposits,
                        },
                    },
                },
            });

            logger.debug(
                `Created attendance bonus day ${tier.day} for user ${userId}: ${tier.reward}`
            );
        }
    } catch (error) {
        logger.error("Error in checkAndCreateAttendanceBonus:", error);
    }
}

/**
 * Record today's login for attendance: bump streak (if new IST day) + create claimable bonuses.
 * Safe to call on every login / session restore / activity progress (same-day is a no-op).
 */
export async function recordDailyLogin(userId: string): Promise<void> {
    try {
        await updateLoginStreak(userId);
        await checkAndCreateAttendanceBonus(userId);
    } catch (error) {
        logger.error("Error in recordDailyLogin:", error);
    }
}

// ============================================================================
// RECHARGE BONUS (INR / USDT) — COLLECTED at credit time
// ============================================================================

export type RechargeBonusChannel = "INR" | "USDT";

/**
 * Credit a % promo on successful deposit as a separate COLLECTED ActivityBonus.
 * Caller already credited `principalInr` via the deposit SUCCESS path.
 * Returns bonus amount applied (0 if off / zero).
 *
 * ADR-0008
 */
export async function creditRechargeBonus(opts: {
    userId: string;
    principalInr: number;
    /** Percent of principal, e.g. 5 = 5% */
    percent: number;
    channel: RechargeBonusChannel;
    depositId: string;
    orderId: string;
    method: string;
    usdtAmount?: number | null;
}): Promise<{ bonus: number; bonusId: string | null }> {
    try {
        const principal = Math.max(0, Number(opts.principalInr) || 0);
        const percent = Math.max(0, Number(opts.percent) || 0);
        if (principal <= 0 || percent <= 0) {
            return { bonus: 0, bonusId: null };
        }

        const bonus = Math.floor((principal * percent) / 100);
        if (bonus <= 0) {
            return { bonus: 0, bonusId: null };
        }

        const type =
            opts.channel === "USDT"
                ? ("USDT_RECHARGE_BONUS" as const)
                : ("INR_RECHARGE_BONUS" as const);

        const now = new Date();

        const result = await prisma.$transaction(async (tx) => {
            const row = await tx.activityBonus.create({
                data: {
                    userId: opts.userId,
                    type: type as any,
                    status: "COLLECTED",
                    amount: bonus,
                    claimAt: now,
                    metadata: {
                        depositId: opts.depositId,
                        orderId: opts.orderId,
                        method: opts.method,
                        channel: opts.channel,
                        percent,
                        principalAmount: principal,
                        usdtAmount: opts.usdtAmount ?? null,
                    },
                },
            });

            await tx.user.update({
                where: { id: opts.userId },
                data: { balance: { increment: bonus } },
            });

            const sysConfig = await SystemSettings.get();
            const rewardMult = (sysConfig as any)?.rewardWagerFactor ?? 1.0;
            const reqWager = Math.ceil(bonus * rewardMult);
            if (reqWager > 0) {
                await tx.wagerRequirement.create({
                    data: {
                        userId: opts.userId,
                        sourceType: "REWARD" as any,
                        sourceId: row.id,
                        amount: bonus,
                        multiplier: rewardMult,
                        requiredWager: reqWager,
                        wagerCleared: 0,
                        isCleared: false,
                    },
                });
            }

            return row;
        });

        logger.info(
            `Recharge bonus ${type} user=${opts.userId} principal=${principal} %=${percent} bonus=${bonus} order=${opts.orderId}`
        );

        return { bonus, bonusId: result.id };
    } catch (error) {
        logger.error("Error in creditRechargeBonus:", error);
        return { bonus: 0, bonusId: null };
    }
}

// ============================================================================
// EXPIRATION
// ============================================================================

export async function expireOldBonuses(): Promise<void> {
    try {
        const now = new Date();

        const result = await prisma.activityBonus.updateMany({
            where: {
                status: "COMPLETED_UNCOLLECTED",
                expiresAt: {
                    lt: now,
                },
            },
            data: {
                status: "EXPIRED",
            },
        });

        if (result.count > 0) {
            logger.debug(`Expired ${result.count} unclaimed bonuses`);
        }
    } catch (error) {
        logger.error("Error in expireOldBonuses:", error);
    }
}
