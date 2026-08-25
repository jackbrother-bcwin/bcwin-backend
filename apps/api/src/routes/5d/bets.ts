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
    place5DBetRequestSchema,
    fiveDBetResponseSchema,
    user5DBetsRequestSchema,
} from "@/schemas/5d";
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

const logger = new Logger("5d-bets");

const place5DBetResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the 5D bet was placed successfully",
        example: true,
    }),
    bet: fiveDBetResponseSchema.openapi({
        description: "Placed 5D bet details",
    }),
});

const user5DBetsResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the 5D bets were fetched successfully",
        example: true,
    }),
    bets: z.array(fiveDBetResponseSchema).openapi({
        description: "List of user 5D bets",
    }),
    total: z.number().openapi({
        description: "Total number of bets",
        example: 50,
    }),
});

const place5DBetRoute = createRoute({
    method: "post",
    tags: ["5d"],
    path: "/bet",
    request: {
        cookies: authCookie,
        body: {
            content: {
                "application/json": {
                    schema: place5DBetRequestSchema,
                },
            },
        },
    },
    responses: {
        201: {
            content: {
                "application/json": {
                    schema: place5DBetResponseSchema,
                },
            },
            description: "5D bet placed successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

const get5DUserBetsRoute = createRoute({
    method: "get",
    tags: ["5d"],
    path: "/bets",
    request: {
        cookies: authCookie,
        query: user5DBetsRequestSchema,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: user5DBetsResponseSchema,
                },
            },
            description: "Get user 5D bets",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

function validate5DBetChoice(
    betCategory: string,
    betType: string,
    betChoice: string,
    position?: string
): boolean {
    // Position category validation
    if (betCategory === "POSITION") {
        if (!position) return false;

        switch (betType) {
            case "EXACT_NUMBER":
                const num = parseInt(betChoice);
                return !isNaN(num) && num >= 0 && num <= 9;
            case "LOW":
                return betChoice === "LOW";
            case "HIGH":
                return betChoice === "HIGH";
            case "ODD":
                return betChoice === "ODD";
            case "EVEN":
                return betChoice === "EVEN";
            default:
                return false;
        }
    }

    // Sum category validation
    if (betCategory === "SUM") {
        if (position) return false; // Position should not be set for sum bets

        switch (betType) {
            case "SUM_EXACT":
                const sumNum = parseInt(betChoice);
                return !isNaN(sumNum) && sumNum >= 0 && sumNum <= 45;
            case "LOW":
                return betChoice === "LOW";
            case "HIGH":
                return betChoice === "HIGH";
            case "ODD":
                return betChoice === "ODD";
            case "EVEN":
                return betChoice === "EVEN";
            default:
                return false;
        }
    }

    return false;
}

export const betRoutes = (app: OpenAPIHono) => {
    app.openapi(place5DBetRoute, async (c) => {
        try {
            const user = c.get("user");
            const {
                periodId,
                betCategory,
                betType,
                position,
                betChoice,
                betAmount,
            } = c.req.valid("json");

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

            // Validate bet choice
            if (
                !validate5DBetChoice(betCategory, betType, betChoice, position)
            ) {
                return apiError(
                    c,
                    "Invalid bet choice for bet type and category",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            // Validate position requirement for POSITION category
            if (betCategory === "POSITION" && !position) {
                return apiError(
                    c,
                    "Position is required for POSITION category bets",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            // Validate position should not be set for SUM category
            if (betCategory === "SUM" && position) {
                return apiError(
                    c,
                    "Position should not be set for SUM category bets",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            const period = await prisma.fiveDPeriod.findUnique({
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

                    const result = await tx.fiveDBet.create({
                        data: {
                            userId: user.id,
                            periodId,
                            betAmount,
                            contractAmount,
                            betType: betType as any,
                            betCategory: betCategory as any,
                            betChoice,
                            position: position as any,
                        },
                        include: {
                            period: {
                                select: {
                                    periodNumber: true,
                                },
                            },
                            fiveDBetResult: true,
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
                WebSocketManager.publishToTopic("admin-5d-bets", {
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
                CacheKey.fiveDBets(user.id)
            );

            // Log IP activity for betting
            const ip = getClientIp(c);
            if (ip) {
                logIpActivity({
                    ip,
                    userId: user.id,
                    activityType: IpActivityType.BETTING,
                    metadata: {
                        game: "5d",
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
                game: "5D",
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
                        betCategory: result.betCategory,
                        betType: result.betType,
                        position: result.position,
                        betChoice: result.betChoice,
                        status: result.status,
                        result: result.fiveDBetResult
                            ? {
                                isWin: result.fiveDBetResult.isWin,
                                winAmount: result.fiveDBetResult.winAmount,
                                multiplier: result.fiveDBetResult.multiplier,
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
            logger.error("Error placing 5D bet:", error);
            return apiError(
                c,
                "Failed to place 5D bet",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.openapi(get5DUserBetsRoute, async (c) => {
        try {
            const user = c.get("user");
            const { periodId, duration, betCategory, position, limit, page } =
                c.req.valid("query");
            const skip = (page - 1) * limit;

            let whereClause: any = { userId: user.id };

            if (periodId) {
                whereClause.periodId = periodId;
            } else if (duration) {
                whereClause.period = { durationSeconds: duration };
            }

            if (betCategory) {
                whereClause.betCategory = betCategory;
            }

            if (position) {
                whereClause.position = position;
            }

            // WebSocketManager.publishToUser(user.id, "account-balance", {
            //     balance: user.balance,
            // });

            const mainCacheKey = CacheKey.fiveDBets(user.id);
            const fieldKey = `p:${periodId || "all"}-d:${duration || "all"}-c:${betCategory || "all"
                }-pos:${position || "all"}-l:${limit}-page:${page}`;

            const cachedData = await Cache.hget<
                Pick<z.infer<typeof user5DBetsResponseSchema>, "bets" | "total">
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
                prisma.fiveDBet.findMany({
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
                        fiveDBetResult: true,
                    },
                }),
                prisma.fiveDBet.count({ where: whereClause }),
            ]);

            const result = {
                bets: bets.map((bet) => ({
                    id: bet.id,
                    periodId: bet.periodId,
                    periodNumber: bet.period.periodNumber,
                    betAmount: bet.betAmount,
                    contractAmount: bet.contractAmount,
                    betCategory: bet.betCategory,
                    betType: bet.betType,
                    position: bet.position,
                    betChoice: bet.betChoice,
                    status: bet.status,
                    result: bet.fiveDBetResult
                        ? {
                            isWin: bet.fiveDBetResult.isWin,
                            winAmount: bet.fiveDBetResult.winAmount,
                            multiplier: bet.fiveDBetResult.multiplier,
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
            logger.error("Error fetching user 5D bets:", error);
            return apiError(
                c,
                "Failed to fetch 5D bets",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
