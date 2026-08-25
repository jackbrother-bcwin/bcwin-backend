import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import {
    apiError,
    calculateContractAmount,
    CommonResponses,
    debitUserBalanceForBet,
    getClientIp,
    InsufficientBalanceError,
    isPeriodBettingLocked,
} from "@/lib/utils";
import { authCookie } from "@/schemas";
import {
    placeBetRequestSchema,
    motoBetResponseSchema,
    userBetsRequestSchema,
} from "@/schemas/moto";
import { WebSocketManager } from "@bcwin/websocket";
import { Cache, CacheKey } from "@bcwin/cache";
import { SelfRebateCalculator } from "@bcwin/rebate";
import {
    checkAndCreateWeeklyBonuses,
    checkAndCreateDailyBonuses,
} from "@bcwin/activity-bonus";
import { logIpActivity, IpActivityType } from "@/lib/ipActivity";
import { syncVipLevelFromXpAsync } from "@/lib/vipLevelSync";
import { requireLifetimeDeposit } from "@/lib/gameDepositGate";

const logger = new Logger("moto-bets");

const placeBetResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the bet was placed successfully",
        example: true,
    }),
    bet: motoBetResponseSchema.openapi({
        description: "Placed bet details",
    }),
});

const userBetsResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the bets were fetched successfully",
        example: true,
    }),
    bets: z.array(motoBetResponseSchema).openapi({
        description: "List of user bets",
    }),
    total: z.number().openapi({
        description: "Total number of bets",
        example: 50,
    }),
});

const placeBetRoute = createRoute({
    method: "post",
    tags: ["moto"],
    path: "/bet",
    request: {
        cookies: authCookie,
        body: {
            content: {
                "application/json": {
                    schema: placeBetRequestSchema,
                },
            },
        },
    },
    responses: {
        201: {
            content: {
                "application/json": {
                    schema: placeBetResponseSchema,
                },
            },
            description: "Bet placed successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

const getUserBetsRoute = createRoute({
    method: "get",
    tags: ["moto"],
    path: "/bets",
    request: {
        cookies: authCookie,
        query: userBetsRequestSchema,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: userBetsResponseSchema,
                },
            },
            description: "Get user bets",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

function validateBetChoice(betType: string, betChoice: string): boolean {
    switch (betType) {
        case "POSITION":
            const bikeNum = parseInt(betChoice);
            return !isNaN(bikeNum) && bikeNum >= 1 && bikeNum <= 10;
        case "ODD_EVEN":
            return ["odd", "even"].includes(betChoice.toLowerCase());
        case "BIG_SMALL":
            return ["big", "small"].includes(betChoice.toLowerCase());
        default:
            return false;
    }
}

function validateTargetPosition(targetPosition: string): boolean {
    return ["FIRST", "SECOND", "THIRD"].includes(targetPosition);
}

export const betRoutes = (app: OpenAPIHono) => {
    app.openapi(placeBetRoute, async (c) => {
        try {
            const user = c.get("user");
            const { periodId, betType, betChoice, targetPosition, betAmount } =
                c.req.valid("json");

            const depositGate = await requireLifetimeDeposit(user, {
                skipDemo: true,
            });
            if (!depositGate.ok) {
                return apiError(
                    c,
                    depositGate.message,
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            if (!validateBetChoice(betType, betChoice)) {
                return apiError(
                    c,
                    "Invalid bet choice for bet type",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            if (!validateTargetPosition(targetPosition)) {
                return apiError(
                    c,
                    "Invalid target position",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            const period = await prisma.motoPeriod.findUnique({
                where: { id: periodId },
            });

            if (!period) {
                return apiError(c, "Period not found", HTTP_STATUS.BAD_REQUEST);
            }

            if (period.status !== "ACTIVE") {
                return apiError(
                    c,
                    "Period is not active for betting",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            if (isPeriodBettingLocked(period)) {
                return apiError(
                    c,
                    "Betting is locked for this period",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            if (user.balance < betAmount) {
                return apiError(
                    c,
                    "Insufficient balance",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            const contractAmount = await calculateContractAmount(betAmount);

            const { result, updatedUser } = await prisma.$transaction(
                async (tx) => {
                    const updatedUser = await debitUserBalanceForBet(
                        tx,
                        user.id,
                        betAmount
                    );

                    const result = await tx.motoBet.create({
                        data: {
                            userId: user.id,
                            periodId,
                            betAmount,
                            contractAmount,
                            betType: betType as any,
                            betChoice,
                            targetPosition: targetPosition as any,
                        },
                        include: {
                            period: {
                                select: {
                                    periodNumber: true,
                                },
                            },
                            motoBetResult: true,
                        },
                    });

                    return { result, updatedUser };
                }
            );

            WebSocketManager.publishToUser(user.id, "account-balance", {
                balance: updatedUser.balance,
            });

            // Demo accounts are excluded from the admin live-bet feed
            if (!user.isDemo) {
                WebSocketManager.publishToTopic("admin-moto-bets", {
                    betId: result.id,
                    userId: user.id,
                    periodId: result.periodId,
                    periodNumber: result.period.periodNumber,
                    betAmount: result.betAmount,
                    betStatus: result.status,
                });
            }

            // Fire-and-forget: Check activity bonuses
            // checkAndCreateWeeklyBonuses(user.id); // WEEKLY_BONUS_ENABLED=false — re-enable later
            checkAndCreateDailyBonuses(user.id);

            await Cache.invalidateUserGameCaches(
                user.id,
                CacheKey.motoBets(user.id)
            );

            // Log IP activity for betting
            const ip = getClientIp(c);
            if (ip) {
                logIpActivity({
                    ip,
                    userId: user.id,
                    activityType: IpActivityType.BETTING,
                    metadata: {
                        game: "moto",
                        betAmount,
                        betId: result.id,
                    },
                });
            }

            // Team Agent commission is priced at IST 24:00 (ADR-0036), not on place.

            // Self-rebate: 0.1% cashback (async, non-blocking)
            SelfRebateCalculator.accrueForBet({
                userId: user.id,
                betAmount,
                game: "MOTO",
            }).catch((err) => logger.error("Error accruing self-rebate:", err));

            syncVipLevelFromXpAsync(user.id);

            return c.json(
                {
                    success: true,
                    bet: {
                        id: result.id,
                        periodId: result.periodId,
                        periodNumber: result.period.periodNumber,
                        betAmount: result.betAmount,
                        contractAmount: result.contractAmount,
                        betType: result.betType,
                        betChoice: result.betChoice,
                        targetPosition: result.targetPosition,
                        status: result.status,
                        result: result.motoBetResult
                            ? {
                                  isWin: result.motoBetResult.isWin,
                                  winAmount: result.motoBetResult.winAmount,
                                  multiplier: result.motoBetResult.multiplier,
                              }
                            : null,
                        createdAt: result.createdAt.toISOString(),
                    },
                },
                HTTP_STATUS.CREATED
            );
        } catch (error) {
            if (error instanceof InsufficientBalanceError) {
                return apiError(
                    c,
                    "Insufficient balance",
                    HTTP_STATUS.BAD_REQUEST
                );
            }
            logger.error("Error placing bet:", error);
            return apiError(
                c,
                "Failed to place bet",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.openapi(getUserBetsRoute, async (c) => {
        try {
            const user = c.get("user");
            const { periodId, duration, limit, page } = c.req.valid("query");
            const skip = (page - 1) * limit;

            let whereClause: any = { userId: user.id };

            if (periodId) {
                whereClause.periodId = periodId;
            } else if (duration) {
                whereClause.period = { durationSeconds: duration };
            }

            // WebSocketManager.publishToUser(user.id, "account-balance", {
            //     balance: user.balance,
            // });

            const mainCacheKey = CacheKey.motoBets(user.id);
            const fieldKey = `p:${periodId || "all"}-d:${
                duration || "all"
            }-l:${limit}-page:${page}`;

            const cachedData = await Cache.hget<
                Pick<z.infer<typeof userBetsResponseSchema>, "bets" | "total">
            >(mainCacheKey, fieldKey);

            if (cachedData) {
                return c.json(
                    {
                        success: true,
                        ...cachedData,
                    },
                    HTTP_STATUS.OK
                );
            }

            const [bets, total] = await Promise.all([
                prisma.motoBet.findMany({
                    where: whereClause,
                    orderBy: { createdAt: "desc" },
                    take: limit,
                    skip,
                    include: {
                        period: {
                            select: {
                                periodNumber: true,
                            },
                        },
                        motoBetResult: true,
                    },
                }),
                prisma.motoBet.count({ where: whereClause }),
            ]);

            const result = {
                bets: bets.map((bet) => ({
                    id: bet.id,
                    periodId: bet.periodId,
                    periodNumber: bet.period.periodNumber,
                    betAmount: bet.betAmount,
                    contractAmount: bet.contractAmount,
                    betType: bet.betType,
                    betChoice: bet.betChoice,
                    targetPosition: bet.targetPosition,
                    status: bet.status,
                    result: bet.motoBetResult
                        ? {
                              isWin: bet.motoBetResult.isWin,
                              winAmount: bet.motoBetResult.winAmount,
                              multiplier: bet.motoBetResult.multiplier,
                          }
                        : null,
                    createdAt: bet.createdAt.toISOString(),
                })),
                total,
            };

            // Short TTL — avoid multi-bet same-period list going stale (1h was too long)
            await Cache.hset(mainCacheKey, fieldKey, result, 15);

            return c.json(
                {
                    success: true,
                    bets: result.bets,
                    total: result.total,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error fetching user bets:", error);
            return apiError(
                c,
                "Failed to fetch bets",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
