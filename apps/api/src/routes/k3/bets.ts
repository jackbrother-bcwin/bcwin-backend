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
    k3BetResponseSchema,
    userBetsRequestSchema,
} from "@/schemas/k3";
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

const logger = new Logger("k3-bets");

const placeBetResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the bet was placed successfully",
        example: true,
    }),
    bet: k3BetResponseSchema.openapi({
        description: "Placed bet details",
    }),
});

const userBetsResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the bets were fetched successfully",
        example: true,
    }),
    bets: z.array(k3BetResponseSchema).openapi({
        description: "List of user bets",
    }),
    total: z.number().openapi({
        description: "Total number of bets",
        example: 50,
    }),
});

const placeBetRoute = createRoute({
    method: "post",
    tags: ["k3"],
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
    tags: ["k3"],
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
        case "SUM":
            const sum = parseInt(betChoice);
            return !isNaN(sum) && sum >= 3 && sum <= 18;

        case "TRIPLE_SPECIFIC":
            const tripleNum = parseInt(betChoice);
            return !isNaN(tripleNum) && tripleNum >= 1 && tripleNum <= 6;

        case "TRIPLE_ANY":
        case "DOUBLE_ANY":
        case "ALL_DIFFERENT":
        case "CONSECUTIVE":
        case "BIG":
        case "SMALL":
        case "ODD":
        case "EVEN":
            return betChoice === betType;

        case "DOUBLE_SPECIFIC":
            // Format: "4,4,6" or "4-4-6"
            const doubleParts = betChoice
                .split(/[,-]/)
                .map((n) => parseInt(n.trim()));
            if (doubleParts.length !== 3) return false;
            if (doubleParts.some((n) => isNaN(n) || n < 1 || n > 6))
                return false;

            const doubleCounts = doubleParts.reduce((acc, n) => {
                acc[n] = (acc[n] || 0) + 1;
                return acc;
            }, {} as Record<number, number>);

            const doubleValues = Object.values(doubleCounts);
            return doubleValues.includes(2) && doubleValues.includes(1);

        case "TWO_NUMBERS":
            // Format: "2,5" or "2-5"
            const twoParts = betChoice
                .split(/[,-]/)
                .map((n) => parseInt(n.trim()));
            return (
                twoParts.length === 2 &&
                twoParts.every((n) => !isNaN(n) && n >= 1 && n <= 6) &&
                twoParts[0] !== twoParts[1]
            );

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

            const period = await prisma.k3Period.findUnique({
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

                    const result = await tx.k3Bet.create({
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
                            k3BetResult: true,
                        },
                    });

                    return { result, updatedUser };
                }
            );

            WebSocketManager.publishToUser(user.id, "account-balance", {
                balance: updatedUser.balance,
            });

            WebSocketManager.publishToTopic("admin-k3-bets", {
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
                CacheKey.k3Bets(user.id)
            );

            // Log IP activity for betting
            const ip = getClientIp(c);
            if (ip) {
                logIpActivity({
                    ip,
                    userId: user.id,
                    activityType: IpActivityType.BETTING,
                    metadata: {
                        game: "k3",
                        betAmount,
                        betId: result.id,
                    },
                });
            }

            // Calculate rebate for this bet (async, non-blocking)
            RebateCalculator.calculateRebateForBet(
                user.id,
                betAmount,
                "K3"
            ).catch((err) => logger.error("Error calculating rebate:", err));

            // Self-rebate: 0.1% cashback (async, non-blocking)
            SelfRebateCalculator.accrueForBet({
                userId: user.id,
                betAmount,
                game: "K3",
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
                        result: result.k3BetResult
                            ? {
                                  isWin: result.k3BetResult.isWin,
                                  winAmount: result.k3BetResult.winAmount,
                                  multiplier: result.k3BetResult.multiplier,
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

            const mainCacheKey = CacheKey.k3Bets(user.id);
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
                prisma.k3Bet.findMany({
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
                        k3BetResult: true,
                    },
                }),
                prisma.k3Bet.count({ where: whereClause }),
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
                    result: bet.k3BetResult
                        ? {
                              isWin: bet.k3BetResult.isWin,
                              winAmount: bet.k3BetResult.winAmount,
                              multiplier: bet.k3BetResult.multiplier,
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
