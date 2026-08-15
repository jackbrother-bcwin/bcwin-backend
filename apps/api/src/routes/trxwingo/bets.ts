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
    wingoBetResponseSchema,
    userBetsRequestSchema,
} from "@/schemas/wingo";
import { WebSocketManager } from "@bcwin/websocket";
import { Cache, CacheKey } from "@bcwin/cache";
import { RebateCalculator, SelfRebateCalculator } from "@bcwin/rebate";
import {
    checkAndCreateWeeklyBonuses,
    checkAndCreateDailyBonuses,
} from "@bcwin/activity-bonus";
import { logIpActivity, IpActivityType } from "@/lib/ipActivity";
import { syncVipLevelFromXpAsync } from "@/lib/vipLevelSync";
import { requireLifetimeDeposit } from "@/lib/gameDepositGate";

const logger = new Logger("trx-wingo-bets");

const placeBetResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the bet was placed successfully",
        example: true,
    }),
    bet: wingoBetResponseSchema.openapi({
        description: "Placed bet details",
    }),
});

const userBetsResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the bets were fetched successfully",
        example: true,
    }),
    bets: z.array(wingoBetResponseSchema).openapi({
        description: "List of user bets",
    }),
    total: z.number().openapi({
        description: "Total number of bets",
        example: 50,
    }),
    currentPage: z.number().openapi({
        description: "Current page number",
        example: 1,
    }),
    totalPages: z.number().openapi({
        description: "Total number of pages",
        example: 5,
    }),
});

const placeBetRoute = createRoute({
    method: "post",
    tags: ["trxwingo"],
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
    tags: ["trxwingo"],
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
        case "COLOR":
            return ["RED", "GREEN", "VIOLET"].includes(betChoice);
        case "NUMBER":
            const num = parseInt(betChoice);
            return !isNaN(num) && num >= 0 && num <= 9;
        case "SIZE":
            return ["BIG", "SMALL"].includes(betChoice);
        default:
            return false;
    }
}

export const betRoutes = (app: OpenAPIHono) => {
    app.openapi(placeBetRoute, async (c) => {
        try {
            const user = c.get("user");
            const { periodId, betType, betChoice, betAmount } =
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

            const period = await prisma.trxWingoPeriod.findUnique({
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

                    const result = await tx.trxWingoBet.create({
                        data: {
                            userId: user.id,
                            periodId,
                            betAmount,
                            contractAmount,
                            betType: betType as any,
                            betChoice,
                        },
                        include: {
                            period: {
                                select: {
                                    periodNumber: true,
                                },
                            },
                            trxWingoBetResult: true,
                        },
                    });

                    return { result, updatedUser };
                }
            );

            WebSocketManager.publishToUser(user.id, "account-balance", {
                balance: updatedUser.balance,
            });

            WebSocketManager.publishToTopic("admin-trx-wingo-bets", {
                betId: result.id,
                userId: user.id,
                periodId: result.periodId,
                periodNumber: result.period.periodNumber,
                betAmount: result.betAmount,
                betStatus: result.status,
            });

            // Fire-and-forget: Check activity bonuses
            // checkAndCreateWeeklyBonuses(user.id); // WEEKLY_BONUS_ENABLED=false — re-enable later
            checkAndCreateDailyBonuses(user.id);

            await Cache.invalidateUserGameCaches(
                user.id,
                CacheKey.trxWingoBets(user.id)
            );

            // Log IP activity for betting
            const ip = getClientIp(c);
            if (ip) {
                logIpActivity({
                    ip,
                    userId: user.id,
                    activityType: IpActivityType.BETTING,
                    metadata: {
                        game: "trxwingo",
                        betAmount,
                        betId: result.id,
                    },
                });
            }

            // Calculate rebate for this bet (async, non-blocking)
            RebateCalculator.calculateRebateForBet(
                user.id,
                betAmount,
                "TRXWINGO"
            ).catch((err) => logger.error("Error calculating rebate:", err));

            // Self-rebate: 0.1% cashback (async, non-blocking)
            SelfRebateCalculator.accrueForBet({
                userId: user.id,
                betAmount,
                game: "TRXWINGO",
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
                        status: result.status,
                        result: result.trxWingoBetResult
                            ? {
                                  isWin: result.trxWingoBetResult.isWin,
                                  winAmount: result.trxWingoBetResult.winAmount,
                                  multiplier:
                                      result.trxWingoBetResult.multiplier,
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

            const mainCacheKey = CacheKey.trxWingoBets(user.id);
            const fieldKey = `p:${periodId || "all"}-d:${
                duration || "all"
            }-l:${limit}-page:${page}`;

            const cachedData = await Cache.hget<
                Pick<z.infer<typeof userBetsResponseSchema>, "bets" | "total">
            >(mainCacheKey, fieldKey);

            if (cachedData) {
                const cachedTotalPages = Math.ceil((cachedData.total ?? 0) / limit);
                return c.json(
                    {
                        success: true,
                        ...cachedData,
                        currentPage: page,
                        totalPages: cachedTotalPages,
                    },
                    HTTP_STATUS.OK
                );
            }

            const [bets, total] = await Promise.all([
                prisma.trxWingoBet.findMany({
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
                        trxWingoBetResult: true,
                    },
                }),
                prisma.trxWingoBet.count({ where: whereClause }),
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
                    status: bet.status,
                    result: bet.trxWingoBetResult
                        ? {
                              isWin: bet.trxWingoBetResult.isWin,
                              winAmount: bet.trxWingoBetResult.winAmount,
                              multiplier: bet.trxWingoBetResult.multiplier,
                          }
                        : null,
                    createdAt: bet.createdAt.toISOString(),
                })),
                total,
            };

            // Short TTL — avoid multi-bet same-period list going stale (1h was too long)
            await Cache.hset(mainCacheKey, fieldKey, result, 15);

            const totalPages = Math.ceil(total / limit);

            return c.json(
                {
                    success: true,
                    bets: result.bets,
                    total: result.total,
                    currentPage: page,
                    totalPages,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error fetching user bets:", error);
            return apiError(
                c,
                "Failed to fetch trxwingo bets",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
