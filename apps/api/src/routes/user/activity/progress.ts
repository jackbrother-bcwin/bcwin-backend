import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import { activityProgressResponseSchema } from "@/schemas/activity";
import {
    FALLBACK_WEEKLY_TIERS,
    WEEKLY_REQUIREMENT_SCALE,
    FALLBACK_DAILY_TIERS,
    FALLBACK_INVITATION_TIERS,
    FALLBACK_FIRST_DEPOSIT_TIERS,
    FALLBACK_ATTENDANCE_TIERS,
    getTotalUserSlotBetsInRange,
    getUserTotalDeposits,
    getUserInvitedUsersWithDeposits,
    recordDailyLogin,
} from "@bcwin/activity-bonus";

const logger = new Logger("activity-progress");

const getActivityProgressRoute = createRoute({
    method: "get",
    tags: ["user"],
    path: "/progress",
    summary: "Get activity bonus progress",
    description:
        "Retrieve current progress across all activity bonus types with tier completion status",
    request: {
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: activityProgressResponseSchema,
                },
            },
            description: "Successfully retrieved activity progress",
        },
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

export const activityProgressRoutes = (app: OpenAPIHono) => {
    app.openapi(getActivityProgressRoute, async (c) => {
        try {
            const user = c.get("user");

            // Keep attendance streak current for long-lived sessions (same-day no-op)
            await recordDailyLogin(user.id);

            // Calculate date ranges
            const now = new Date();
            const sevenDaysAgo = new Date(
                now.getTime() - 7 * 24 * 60 * 60 * 1000
            );
            const startOfDay = new Date(now);
            startOfDay.setUTCHours(0, 0, 0, 0);
            const endOfDay = new Date(now);
            endOfDay.setUTCHours(23, 59, 59, 999);

            // Fetch all necessary data in parallel (including dynamic DB tiers)
            const [
                weeklyBets,
                dailyDeposits,
                dailyBets,
                totalDeposits,
                existingBonuses,
                depositCount,
                currentUser,
                dbWeeklyTiers,
                dbDailyTiers,
                dbInvitationTiers,
                dbFirstDepositTiers,
                dbAttendanceTiers,
            ] = await Promise.all([
                getTotalUserSlotBetsInRange(user.id, sevenDaysAgo, now),
                getUserTotalDeposits(user.id, startOfDay, endOfDay),
                getTotalUserSlotBetsInRange(user.id, startOfDay, endOfDay),
                getUserTotalDeposits(user.id),
                prisma.activityBonus.findMany({
                    where: { userId: user.id },
                    select: {
                        id: true,
                        type: true,
                        status: true,
                        metadata: true,
                        expiresAt: true,
                    },
                }),
                prisma.deposit.count({
                    where: { userId: user.id, status: "SUCCESS" },
                }),
                prisma.user.findUnique({
                    where: { id: user.id },
                    select: { loginStreak: true },
                }),
                prisma.activityBonusTier.findMany({
                    where: { type: "WEEKLY" },
                    orderBy: { betRequirement: "asc" },
                }),
                prisma.activityBonusTier.findMany({
                    where: { type: "DAILY" },
                    orderBy: [{ depositRequirement: "asc" }, { betRequirement: "asc" }],
                }),
                prisma.activityBonusTier.findMany({
                    where: { type: "INVITATION" },
                    orderBy: [{ inviteRequirement: "asc" }, { depositRequirement: "asc" }],
                }),
                prisma.activityBonusTier.findMany({
                    where: { type: "FIRST_DEPOSIT" },
                    orderBy: { depositRequirement: "asc" },
                }),
                prisma.activityBonusTier.findMany({
                    where: { type: "ATTENDENCE" },
                    orderBy: { dayRequirement: "asc" },
                }),
            ]);

            // Resolve dynamic tiers with fallbacks (same logic as activityBonusService)
            // WEEKLY_REQUIREMENT_SCALE doubles DB betRequirement until admin rows are updated
            const weeklyTiers =
                dbWeeklyTiers.length > 0
                    ? dbWeeklyTiers.map((t) => ({
                          requirement:
                              (t.betRequirement || 0) * WEEKLY_REQUIREMENT_SCALE,
                          reward: t.reward,
                      }))
                    : FALLBACK_WEEKLY_TIERS;

            const dailyTiers = dbDailyTiers.length > 0
                ? dbDailyTiers.map(t => ({ deposit: t.depositRequirement || 0, bet: t.betRequirement || 0, reward: t.reward }))
                : FALLBACK_DAILY_TIERS;

            const invitationTiers = dbInvitationTiers.length > 0
                ? dbInvitationTiers.map(t => ({ invites: t.inviteRequirement || 1, minDeposit: t.depositRequirement || 0, reward: t.reward }))
                : FALLBACK_INVITATION_TIERS;

            const firstDepositTiersList = dbFirstDepositTiers.length > 0
                ? dbFirstDepositTiers.map(t => ({ requirement: t.depositRequirement || 0, reward: t.reward }))
                : FALLBACK_FIRST_DEPOSIT_TIERS;

            const attendanceTiers = dbAttendanceTiers.length > 0
                ? dbAttendanceTiers.map(t => ({ day: t.dayRequirement || 1, accumulatedDeposit: t.depositRequirement || 0, reward: t.reward }))
                : FALLBACK_ATTENDANCE_TIERS;

            // Helper to check if tier is claimed or expired
            const getTierStatus = (type: string, tier: number) => {
                const bonus = existingBonuses.find(
                    (b) => b.type === type && (b.metadata as any)?.tier === tier
                );

                return {
                    claimed: bonus?.status === "COLLECTED",
                    expired: bonus?.status === "EXPIRED",
                    completed:
                        bonus?.status === "COMPLETED_UNCOLLECTED" ||
                        bonus?.status === "COLLECTED" ||
                        bonus?.status === "EXPIRED",
                    bonusId: bonus?.id || null,
                };
            };

            // Process weekly tiers
            const weeklyProgress = weeklyTiers.map((tier, index) => {
                const status = getTierStatus("WEEKLY", index);
                return {
                    tier: index,
                    requirement: {
                        slotBet: tier.requirement,
                    },
                    current: {
                        slotBet: weeklyBets,
                    },
                    reward: tier.reward,
                    completed:
                        status.completed || weeklyBets >= tier.requirement,
                    claimed: status.claimed,
                    expired: status.expired,
                    bonusId: status.bonusId,
                };
            });

            // Process daily tiers
            const dailyProgress = dailyTiers.map((tier, index) => {
                const status = getTierStatus("DAILY", index);
                const completed =
                    status.completed ||
                    (dailyDeposits >= tier.deposit && dailyBets >= tier.bet);

                return {
                    tier: index,
                    requirement: {
                        deposit: tier.deposit,
                        slotBet: tier.bet,
                    },
                    current: {
                        deposit: dailyDeposits,
                        slotBet: dailyBets,
                    },
                    reward: tier.reward,
                    completed,
                    claimed: status.claimed,
                    expired: status.expired,
                    bonusId: status.bonusId,
                };
            });

            // Process invitation tiers (fetch counts in parallel)
            const invitationCounts = await Promise.all(
                invitationTiers.map((tier) =>
                    getUserInvitedUsersWithDeposits(user.id, tier.minDeposit)
                )
            );

            const invitationProgress = invitationTiers.map((tier, index) => {
                const status = getTierStatus("INVITATION", index);
                const qualifyingInvites = invitationCounts[index];

                return {
                    tier: index,
                    requirement: {
                        invites: tier.invites,
                        minDepositPerInvite: tier.minDeposit,
                    },
                    current: {
                        qualifyingInvites,
                    },
                    reward: tier.reward,
                    completed:
                        status.completed || qualifyingInvites >= tier.invites,
                    claimed: status.claimed,
                    expired: status.expired,
                    bonusId: status.bonusId,
                };
            });

            // Process first deposit
            // Rules: only first SUCCESS deposit counts; only MAX qualifying tier
            // is claimable once; all other tiers are unavailable (no multi-bar fill).
            const firstDepositBonus = existingBonuses.find(
                (b) => b.type === "FIRST_DEPOSIT"
            );

            let firstDepositAmount = 0;

            if (depositCount >= 1) {
                const firstDeposit = await prisma.deposit.findFirst({
                    where: { userId: user.id, status: "SUCCESS" },
                    orderBy: { createdAt: "asc" },
                    select: { amount: true },
                });

                if (firstDeposit) {
                    firstDepositAmount = firstDeposit.amount;
                }
            }

            const bonusMeta = (firstDepositBonus?.metadata ?? {}) as {
                tier?: number;
            };
            const lockedTierIndex =
                typeof bonusMeta.tier === "number" ? bonusMeta.tier : -1;

            // Highest tier first-deposit amount would qualify for (display only if no bonus yet)
            let maxQualifyingIndex = -1;
            if (firstDepositAmount > 0) {
                for (let i = 0; i < firstDepositTiersList.length; i++) {
                    if (
                        firstDepositAmount >=
                        firstDepositTiersList[i]!.requirement
                    ) {
                        maxQualifyingIndex = i;
                    }
                }
            }

            // Single locked tier: bonus metadata wins; else computed max (pre-bonus edge)
            const activeTierIndex =
                lockedTierIndex >= 0 ? lockedTierIndex : maxQualifyingIndex;

            const bonusStatus = firstDepositBonus?.status ?? null;
            const isCollected = bonusStatus === "COLLECTED";
            const isUncollected = bonusStatus === "COMPLETED_UNCOLLECTED";

            const firstDepositTiers = firstDepositTiersList.map(
                (tier, index) => {
                    const isActiveTier = activeTierIndex === index;
                    const isClaimed = isCollected && isActiveTier;
                    // Only the max (locked) tier can be claimed — once
                    const isEligible =
                        isUncollected &&
                        isActiveTier &&
                        !!firstDepositBonus?.id;
                    // After first deposit, non-winning tiers are locked out
                    const unavailable =
                        (depositCount >= 1 || !!firstDepositBonus) &&
                        !isActiveTier;

                    // Progress bar: only active tier reflects first deposit amount
                    const current = isActiveTier
                        ? Math.min(firstDepositAmount, tier.requirement)
                        : 0;

                    return {
                        tier: index,
                        requirement: {
                            deposit: tier.requirement,
                        },
                        current: {
                            deposit: current,
                        },
                        reward: tier.reward,
                        eligible: isEligible,
                        claimed: isClaimed,
                        unavailable,
                        // Claim needs bonusId while COMPLETED_UNCOLLECTED
                        bonusId:
                            isActiveTier && firstDepositBonus?.id
                                ? firstDepositBonus.id
                                : null,
                    };
                }
            );

            const firstDepositData = {
                tiers: firstDepositTiers,
                currentDeposit: firstDepositAmount,
                /** True when there is something to claim */
                eligible: isUncollected && !!firstDepositBonus,
                claimed: isCollected,
                claimedTier:
                    isCollected && lockedTierIndex >= 0
                        ? lockedTierIndex
                        : undefined,
                /** Home popup: no deposit yet, or uncollected bonus */
                offerPopup:
                    !isCollected &&
                    bonusStatus !== "EXPIRED" &&
                    (depositCount === 0 || isUncollected),
            };

            // Process attendance tiers
            const currentStreak = currentUser?.loginStreak || 0;

            const attendanceProgress = attendanceTiers.map((tier, index) => {
                const status = getTierStatus("ATTENDENCE", index);
                const completed =
                    status.completed ||
                    (currentStreak >= tier.day &&
                        totalDeposits >= tier.accumulatedDeposit);

                return {
                    tier: index,
                    day: tier.day,
                    requirement: {
                        day: tier.day,
                        accumulatedDeposit: tier.accumulatedDeposit,
                    },
                    current: {
                        day: currentStreak,
                        accumulatedDeposit: totalDeposits,
                    },
                    reward: tier.reward,
                    completed,
                    claimed: status.claimed,
                    expired: status.expired,
                    bonusId: status.bonusId,
                };
            });

            return c.json(
                {
                    success: true,
                    data: {
                        weekly: weeklyProgress,
                        daily: dailyProgress,
                        invitation: invitationProgress,
                        firstDeposit: firstDepositData,
                        attendance: {
                            currentStreak,
                            tiers: attendanceProgress,
                        },
                    },
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error fetching activity progress:", error);
            return apiError(
                c,
                "Failed to fetch activity progress",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
