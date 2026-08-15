import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import {
    userVipStatusSchema,
    vipLevelRequirementSchema,
    claimVipRewardSchema,
    vipRewardClaimsQuerySchema,
    vipRewardClaimRecordSchema,
} from "@/schemas/vip";
import { Cache, CacheKey } from "@bcwin/cache";
import { WebSocketManager } from "@bcwin/websocket";
import { createWagerRequirement } from "@/lib/wagerEngine";
import { syncVipLevelFromXp } from "@/lib/vipLevelSync";
import { istMonthYear, nextIstMonthSettlement } from "@/lib/istDate";
import { getSelfRebateRatePercent } from "@bcwin/rebate";

const logger = new Logger("vip-routes");

/**
 * Monthly reward: current XP VIP only; first claim after next 1st 02:00 IST
 * following level-up (or last monthly). One claim per user per IST month.
 */
async function resolveMonthlyClaimWindow(
    userId: string,
    currentLevel: number
): Promise<{
    level: number;
    canClaim: boolean;
    nextClaimAt: string | null;
    lastClaimAt: string | null;
}> {
    if (currentLevel < 1) {
        return {
            level: 0,
            canClaim: false,
            nextClaimAt: null,
            lastClaimAt: null,
        };
    }

    const [lastMonthly, levelUp, vipRow] = await Promise.all([
        prisma.vipRewardClaim.findFirst({
            where: { userId, type: "MONTHLY" },
            orderBy: { createdAt: "desc" },
        }),
        prisma.vipRewardClaim.findFirst({
            where: { userId, type: "LEVEL_UP", level: currentLevel },
            orderBy: { createdAt: "desc" },
        }),
        prisma.userVipLevel.findUnique({
            where: { userId },
            select: { createdAt: true },
        }),
    ]);

    const holdFrom =
        lastMonthly?.createdAt ??
        levelUp?.createdAt ??
        vipRow?.createdAt ??
        new Date();

    const nextAt = nextIstMonthSettlement(holdFrom);
    const canClaim = Date.now() >= nextAt.getTime();

    return {
        level: currentLevel,
        canClaim,
        nextClaimAt: canClaim ? null : nextAt.toISOString(),
        lastClaimAt: lastMonthly?.createdAt.toISOString() ?? null,
    };
}

const vipStatusResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    data: userVipStatusSchema.openapi({
        description: "User VIP status information",
    }),
});

const vipRequirementsResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    data: z.array(vipLevelRequirementSchema).openapi({
        description: "Array of VIP level requirements",
    }),
});

const claimRewardResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    message: z.string().openapi({
        description: "Status message",
        example: "VIP level up reward claimed successfully",
    }),
    amount: z.number().openapi({
        description: "Reward amount claimed",
        example: 150,
    }),
    newBalance: z.number().openapi({
        description: "Updated user account balance",
        example: 1150,
    }),
});

const vipRewardClaimsHistoryResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    data: z.array(vipRewardClaimRecordSchema).openapi({
        description: "Array of VIP reward claim records",
    }),
    total: z.number().openapi({
        description: "Total number of claim records",
        example: 5,
    }),
    currentPage: z.number().openapi({
        description: "Current page number",
        example: 1,
    }),
    totalPages: z.number().openapi({
        description: "Total number of pages",
        example: 1,
    }),
});

const getUserVipStatusRoute = createRoute({
    method: "get",
    tags: ["user"],
    path: "/vip/status",
    summary: "Get user VIP status",
    description: "Retrieve current VIP level, requirements, XP, and progress",
    request: {
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: vipStatusResponseSchema,
                },
            },
            description: "Successfully retrieved VIP status",
        },
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

const getVipRequirementsRoute = createRoute({
    method: "get",
    tags: ["user"],
    path: "/vip/requirements",
    summary: "Get all VIP level requirements",
    description: "Retrieve requirements for all VIP levels (0-10)",
    request: {
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: vipRequirementsResponseSchema,
                },
            },
            description: "Successfully retrieved VIP requirements",
        },
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

const claimVipRewardRoute = createRoute({
    method: "post",
    tags: ["user"],
    path: "/vip/claim-reward",
    summary: "Claim VIP Level-up or Monthly reward",
    description: "Claim earned level-up reward or monthly maintenance reward for a VIP level",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: claimVipRewardSchema,
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: claimRewardResponseSchema,
                },
            },
            description: "Successfully claimed VIP reward",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

const getVipRewardClaimsHistoryRoute = createRoute({
    method: "get",
    tags: ["user"],
    path: "/vip/claim-history",
    summary: "Get VIP reward claims history",
    description: "Retrieve history of claimed VIP level-up and monthly rewards with pagination and filters",
    request: {
        cookies: authCookie,
        query: vipRewardClaimsQuerySchema,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: vipRewardClaimsHistoryResponseSchema,
                },
            },
            description: "Successfully retrieved VIP reward claims history",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

export const vipRoutes = (app: OpenAPIHono) => {
    app.openapi(getUserVipStatusRoute, async (c) => {
        try {
            const userCtx = c.get("user");

            // Fetch user for current XP
            const user = await prisma.user.findUnique({
                where: { id: userCtx.id },
                select: { id: true, xp: true },
            });

            const userXp = user?.xp || 0;

            // XP updates on every bet; level must match XP immediately (not only 02:00 cron)
            await syncVipLevelFromXp(userCtx.id);

            // Get user VIP level (after sync)
            const vipLevel = await prisma.userVipLevel.findUnique({
                where: { userId: userCtx.id },
            });

            // currentLevel = XP VIP (rewards); rebateLevel = agency rates (ADR-0012)
            const currentLevel = vipLevel?.currentLevel || 0;
            const rebateLevel = vipLevel?.rebateLevel || 0;

            // Prefer snapshots on UserVipLevel; fall back to TeamMetrics
            const teamMetrics = await prisma.teamMetrics.findUnique({
                where: { userId: userCtx.id },
            });

            const teamSize =
                vipLevel?.teamSize || teamMetrics?.totalTeamSize || 0;
            const teamBetting =
                vipLevel?.teamBetting || teamMetrics?.totalTeamBetting || 0;
            const teamDeposit =
                vipLevel?.teamDeposit || teamMetrics?.totalTeamDeposit || 0;

            const monthlyClaim = await resolveMonthlyClaimWindow(
                userCtx.id,
                currentLevel
            );

            // Get current XP VIP level requirements
            const currentRequirement =
                await prisma.vipLevelRequirement.findUnique({
                    where: { level: currentLevel },
                });

            // Get next XP VIP level requirements (if not at max level)
            const nextLevel = currentLevel < 10 ? currentLevel + 1 : null;
            const nextRequirement = nextLevel
                ? await prisma.vipLevelRequirement.findUnique({
                      where: { level: nextLevel },
                  })
                : null;

            // Calculate progress towards next XP VIP level
            let progress = null;
            if (nextRequirement && nextRequirement.expRequired > 0) {
                const xpProgress = Math.min(
                    100,
                    (userXp / nextRequirement.expRequired) * 100
                );
                progress = {
                    xp: parseFloat(xpProgress.toFixed(2)),
                };
            }

            // Commission rate table is legacy; still keyed by level index
            const commissionRates =
                await prisma.commissionRateConfig.findUnique({
                    where: { vipLevel: rebateLevel },
                });

            const vipStatusData = {
                currentLevel,
                rebateLevel,
                nextLevel,
                xp: userXp,
                teamSize,
                teamBetting,
                teamDeposit,
                currentRequirements: {
                    level: currentRequirement?.level ?? currentLevel,
                    expRequired: currentRequirement?.expRequired ?? 0,
                    levelUpReward: currentRequirement?.levelUpReward ?? 0,
                    monthlyReward: currentRequirement?.monthlyReward ?? 0,
                    rebateRate: currentRequirement?.rebateRate ?? null,
                    selfRebatePercent: await getSelfRebateRatePercent(
                        currentRequirement?.level ?? currentLevel
                    ),
                    teamSize: currentRequirement?.teamSize ?? 0,
                    teamBetting: currentRequirement?.teamBetting ?? 0,
                    teamDeposit: currentRequirement?.teamDeposit ?? 0,
                },
                nextRequirements: nextRequirement
                    ? {
                          level: nextRequirement.level,
                          expRequired: nextRequirement.expRequired,
                          levelUpReward: nextRequirement.levelUpReward,
                          monthlyReward: nextRequirement.monthlyReward,
                          rebateRate: nextRequirement.rebateRate,
                          selfRebatePercent: await getSelfRebateRatePercent(
                              nextRequirement.level
                          ),
                          teamSize: nextRequirement.teamSize,
                          teamBetting: nextRequirement.teamBetting,
                          teamDeposit: nextRequirement.teamDeposit,
                      }
                    : null,
                progress,
                commissionRates: commissionRates
                    ? {
                          vipLevel: commissionRates.vipLevel,
                          layer1: commissionRates.layer1,
                          layer2: commissionRates.layer2,
                          layer3: commissionRates.layer3,
                          layer4: commissionRates.layer4,
                          layer5: commissionRates.layer5,
                          layer6: commissionRates.layer6,
                      }
                    : null,
                lastCalculatedAt:
                    vipLevel?.lastCalculatedAt.toISOString() ||
                    new Date().toISOString(),
                monthlyClaim,
            };

            return c.json(
                {
                    success: true,
                    data: vipStatusData,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error fetching VIP status:", error);
            return apiError(
                c,
                "Failed to fetch VIP status",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.openapi(getVipRequirementsRoute, async (c) => {
        try {
            const cachedRequirements = await Cache.get<any[]>(
                CacheKey.vipRequirements
            );

            if (cachedRequirements) {
                return c.json(
                    {
                        success: true,
                        data: cachedRequirements,
                    },
                    HTTP_STATUS.OK
                );
            }

            const requirements = await prisma.vipLevelRequirement.findMany({
                orderBy: { level: "asc" },
            });

            const requirementsData = await Promise.all(
                requirements.map(async (req) => ({
                    level: req.level,
                    expRequired: req.expRequired,
                    levelUpReward: req.levelUpReward,
                    monthlyReward: req.monthlyReward,
                    rebateRate: req.rebateRate,
                    selfRebatePercent: await getSelfRebateRatePercent(req.level),
                    teamSize: req.teamSize,
                    teamBetting: req.teamBetting,
                    teamDeposit: req.teamDeposit,
                }))
            );

            await Cache.set(
                CacheKey.vipRequirements,
                requirementsData,
                60 * 60
            );

            return c.json(
                {
                    success: true,
                    data: requirementsData,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error fetching VIP requirements:", error);
            return apiError(
                c,
                "Failed to fetch VIP requirements",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.openapi(claimVipRewardRoute, async (c) => {
        try {
            const userCtx = c.get("user");
            const { level, type } = c.req.valid("json");

            // Sync XP→level so claim works right after crossing a threshold
            const currentLevel = await syncVipLevelFromXp(userCtx.id);

            if (level > currentLevel) {
                return apiError(
                    c,
                    `You must be at least VIP Level ${level} to claim this reward. Current level is ${currentLevel}.`,
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            const requirement = await prisma.vipLevelRequirement.findUnique({
                where: { level },
            });

            if (!requirement) {
                return apiError(
                    c,
                    `VIP Level ${level} requirement configuration not found`,
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            const now = new Date();
            const monthYear = istMonthYear(now);

            let rewardAmount = 0;
            let claimMonthYear: string | null = null;

            if (type === "LEVEL_UP") {
                rewardAmount = requirement.levelUpReward;
                if (rewardAmount <= 0) {
                    return apiError(
                        c,
                        `No level-up reward for VIP level ${level}`,
                        HTTP_STATUS.BAD_REQUEST
                    );
                }

                const existingClaim = await prisma.vipRewardClaim.findFirst({
                    where: {
                        userId: userCtx.id,
                        level,
                        type: "LEVEL_UP",
                    },
                });

                if (existingClaim) {
                    return apiError(
                        c,
                        `VIP Level ${level} level-up reward has already been claimed`,
                        HTTP_STATUS.BAD_REQUEST
                    );
                }
            } else if (type === "MONTHLY") {
                if (level !== currentLevel) {
                    return apiError(
                        c,
                        `Monthly reward can only be claimed for your current VIP level (VIP${currentLevel})`,
                        HTTP_STATUS.BAD_REQUEST
                    );
                }

                rewardAmount = requirement.monthlyReward;
                if (rewardAmount <= 0) {
                    return apiError(
                        c,
                        `No monthly reward for VIP level ${level}`,
                        HTTP_STATUS.BAD_REQUEST
                    );
                }

                const window = await resolveMonthlyClaimWindow(
                    userCtx.id,
                    currentLevel
                );
                if (!window.canClaim) {
                    return apiError(
                        c,
                        window.nextClaimAt
                            ? `Monthly reward available after ${window.nextClaimAt}`
                            : "Monthly reward is not available yet",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }

                claimMonthYear = monthYear;

                const existingThisMonth = await prisma.vipRewardClaim.findFirst({
                    where: {
                        userId: userCtx.id,
                        type: "MONTHLY",
                        monthYear: claimMonthYear,
                    },
                });

                if (existingThisMonth) {
                    return apiError(
                        c,
                        `Monthly VIP reward for ${monthYear} has already been claimed`,
                        HTTP_STATUS.BAD_REQUEST
                    );
                }
            }

            const { updatedUser } = await prisma.$transaction(async (tx) => {
                const updatedUser = await tx.user.update({
                    where: { id: userCtx.id },
                    data: {
                        balance: { increment: rewardAmount },
                    },
                    select: {
                        balance: true,
                    },
                });

                const claimRecord = await tx.vipRewardClaim.create({
                    data: {
                        userId: userCtx.id,
                        level,
                        type: type as any,
                        amount: rewardAmount,
                        monthYear: claimMonthYear,
                    },
                });

                await createWagerRequirement(tx, userCtx.id, "REWARD", rewardAmount, claimRecord.id);

                return { updatedUser };
            });

            WebSocketManager.publishToUser(userCtx.id, "account-balance", {
                balance: updatedUser.balance,
            });

            // Clear status cache & claim history cache
            await Cache.del(CacheKey.vipStatus(userCtx.id));
            await Cache.del(CacheKey.vipRewardClaims(userCtx.id));

            return c.json(
                {
                    success: true,
                    message: `VIP Level ${level} ${type === "LEVEL_UP" ? "level-up" : "monthly"} reward of ₹${rewardAmount} claimed successfully`,
                    amount: rewardAmount,
                    newBalance: updatedUser.balance,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error claiming VIP reward:", error);
            return apiError(
                c,
                "Failed to claim VIP reward",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.openapi(getVipRewardClaimsHistoryRoute, async (c) => {
        try {
            const user = c.get("user");
            const { page, limit, type } = c.req.valid("query");

            const skip = (page - 1) * limit;

            const mainCacheKey = CacheKey.vipRewardClaims(user.id);
            const fieldKey = `type:${type || "all"}-page:${page}-limit:${limit}`;

            const cachedData = await Cache.hget<{
                data: Array<{
                    id: string;
                    level: number;
                    type: "LEVEL_UP" | "MONTHLY";
                    amount: number;
                    monthYear: string | null;
                    createdAt: string;
                }>;
                total: number;
                currentPage: number;
                totalPages: number;
            }>(mainCacheKey, fieldKey);

            if (cachedData) {
                return c.json(
                    {
                        success: true,
                        ...cachedData,
                    },
                    HTTP_STATUS.OK
                );
            }

            let whereClause: any = {
                userId: user.id,
            };

            if (type && type !== "all") {
                whereClause.type = type as any;
            }

            const [claims, total] = await Promise.all([
                prisma.vipRewardClaim.findMany({
                    where: whereClause,
                    orderBy: { createdAt: "desc" },
                    take: limit,
                    skip,
                }),
                prisma.vipRewardClaim.count({ where: whereClause }),
            ]);

            const totalPages = Math.ceil(total / limit);

            const result = {
                data: claims.map((claim) => ({
                    id: claim.id,
                    level: claim.level,
                    type: claim.type,
                    amount: claim.amount,
                    monthYear: claim.monthYear,
                    createdAt: claim.createdAt.toISOString(),
                })),
                total,
                currentPage: page,
                totalPages,
            };

            // Cache for 15 minutes
            await Cache.hset(mainCacheKey, fieldKey, result, 60 * 15);

            return c.json(
                {
                    success: true,
                    ...result,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error fetching VIP reward claims history:", error);
            return apiError(
                c,
                "Failed to fetch VIP reward claims history",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
