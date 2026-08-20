import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { apiError, CommonResponses } from "@/lib/utils";
import { HTTP_STATUS } from "@/lib/http";
import { authCookie } from "@/schemas";
import { Cache, CacheKey } from "@bcwin/cache";
import { REAL_USER_WHERE } from "@/lib/realUserFilter";
import {
    firstOfIstMonth,
    istInclusiveDay,
    istInclusiveRange,
    mondayOfIstWeek,
    prevIstMonthRange,
    shiftYmdIst,
    ymdIst,
} from "@/lib/istDate";

const logger = new Logger("admin-profit-loss");

// Date filter type
const dateFilterSchema = z
    .enum([
        "today",
        "yesterday",
        "this_week",
        "last_week",
        "this_month",
        "last_month",
    ])
    .openapi({
        description: "Date filter for profit and loss data",
        example: "today",
    });

/** IST 00:00–24:00 buckets (ADR-0030). */
function getDateRange(filter: string): { start: Date; end: Date } {
    const today = ymdIst();
    switch (filter) {
        case "today":
            return istInclusiveDay(today);
        case "yesterday":
            return istInclusiveDay(shiftYmdIst(today, -1));
        case "this_week":
            return istInclusiveRange(mondayOfIstWeek(), today);
        case "last_week": {
            const thisMon = mondayOfIstWeek();
            const lastMon = shiftYmdIst(thisMon, -7);
            const lastSun = shiftYmdIst(thisMon, -1);
            return istInclusiveRange(lastMon, lastSun);
        }
        case "this_month":
            return istInclusiveRange(firstOfIstMonth(today), today);
        case "last_month":
            return prevIstMonthRange(today);
        default:
            return istInclusiveDay(today);
    }
}

// Game statistics schema
const gameStatisticsSchema = z.object({
    gameName: z.string().openapi({
        description: "Game name (wingo, trx, 5d, k3, moto, inout)",
        example: "wingo",
    }),
    totalBets: z.number().openapi({
        description: "Total number of bets",
        example: 1500,
    }),
    totalInvested: z.number().openapi({
        description: "Total amount invested (bet amount)",
        example: 50000.0,
    }),
    totalWon: z.number().openapi({
        description: "Total amount won",
        example: 45000.0,
    }),
    winRate: z.number().openapi({
        description: "Win rate percentage",
        example: 65.5,
    }),
    netPL: z.number().openapi({
        description: "Net profit/loss (invested - won)",
        example: 5000.0,
    }),
    roi: z.number().openapi({
        description: "Return on investment percentage",
        example: 10.0,
    }),
});

// Card items schema
const cardItemsSchema = z.object({
    totalBets: z.number().openapi({
        description: "Total number of bets",
        example: 5000,
    }),
    totalWins: z.number().openapi({
        description: "Total number of winning bets",
        example: 3200,
    }),
    totalLosses: z.number().openapi({
        description: "Total number of losing bets",
        example: 1800,
    }),
    totalInvested: z.number().openapi({
        description: "Total amount invested",
        example: 200000.0,
    }),
    avgBet: z.number().openapi({
        description: "Average bet size",
        example: 40.0,
    }),
    winRate: z.number().openapi({
        description: "Win rate percentage",
        example: 64.0,
    }),
    lossRate: z.number().openapi({
        description: "Loss rate percentage",
        example: 36.0,
    }),
    netPL: z.number().openapi({
        description: "Net profit/loss for admin",
        example: 15000.0,
    }),
    roi: z.number().openapi({
        description: "Return on investment percentage",
        example: 7.5,
    }),
});

// Win/Loss distribution schema
const winLossDistributionSchema = z.object({
    totalWin: z.number().openapi({
        description: "Total win amount",
        example: 185000.0,
    }),
    totalLoss: z.number().openapi({
        description: "Total loss amount (bets that didn't win)",
        example: 15000.0,
    }),
});

// Main profit and loss response schema
const profitLossResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    data: z.object({
        dateFilter: z.string().openapi({
            description: "Applied date filter",
            example: "today",
        }),
        cardItems: cardItemsSchema,
        winLossDistribution: winLossDistributionSchema,
        gameStatistics: z.array(gameStatisticsSchema),
    }),
});

// Game-wise statistics response schema
const gameWiseStatisticsResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    data: z.array(gameStatisticsSchema),
});

// Main profit and loss route
const getProfitLossRoute = createRoute({
    method: "get",
    path: "/",
    tags: ["admin"],
    summary: "Get profit and loss dashboard",
    description:
        "Get profit and loss metrics with date filters, win/loss distribution, game performance, and card items",
    request: {
        query: z.object({
            dateFilter: dateFilterSchema.optional().default("today"),
        }),
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: profitLossResponseSchema,
                },
            },
            description: "Profit and loss data retrieved successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

// Game-wise statistics route
const getGameWiseStatisticsRoute = createRoute({
    method: "get",
    path: "/game-statistics",
    tags: ["admin"],
    summary: "Get game-wise statistics",
    description:
        "Get detailed statistics for each game (wingo, trx, 5d, k3, moto, inout) in JSON format",
    request: {
        query: z.object({
            dateFilter: dateFilterSchema.optional().default("today"),
        }),
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: gameWiseStatisticsResponseSchema,
                },
            },
            description: "Game-wise statistics retrieved successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

type ProfitLossData = z.infer<typeof profitLossResponseSchema>["data"];

// Helper function to calculate game statistics
async function calculateGameStatistics(
    gameName: string,
    dateRange: { start: Date; end: Date }
): Promise<z.infer<typeof gameStatisticsSchema>> {
    let betModel: any;
    let resultModel: any;

    switch (gameName) {
        case "wingo":
            betModel = prisma.wingoBet;
            resultModel = prisma.wingoBetResult;
            break;
        case "trx":
            betModel = prisma.trxWingoBet;
            resultModel = prisma.trxWingoBetResult;
            break;
        case "5d":
            betModel = prisma.fiveDBet;
            resultModel = prisma.fiveDBetResult;
            break;
        case "k3":
            betModel = prisma.k3Bet;
            resultModel = prisma.k3BetResult;
            break;
        case "moto":
            betModel = prisma.motoBet;
            resultModel = prisma.motoBetResult;
            break;
        case "inout":
            betModel = prisma.inoutBet;
            resultModel = null; // inout doesn't have a separate result model
            break;
        default:
            throw new Error(`Unknown game: ${gameName}`);
    }

    // For inout, winAmount is stored directly on the bet
    if (gameName === "inout") {
        const [betsAggregate, winsAggregate, totalBetsCount, winningBetsCount] =
            await Promise.all([
                betModel.aggregate({
                    where: {
                        createdAt: {
                            gte: dateRange.start,
                            lte: dateRange.end,
                        },
                        user: REAL_USER_WHERE,
                    },
                    _sum: { betAmount: true },
                    _count: true,
                }),
                betModel.aggregate({
                    where: {
                        createdAt: {
                            gte: dateRange.start,
                            lte: dateRange.end,
                        },
                        winAmount: { gt: 0 },
                        user: REAL_USER_WHERE,
                    },
                    _sum: { winAmount: true },
                }),
                betModel.count({
                    where: {
                        createdAt: {
                            gte: dateRange.start,
                            lte: dateRange.end,
                        },
                        user: REAL_USER_WHERE,
                    },
                }),
                betModel.count({
                    where: {
                        createdAt: {
                            gte: dateRange.start,
                            lte: dateRange.end,
                        },
                        winAmount: { gt: 0 },
                        user: REAL_USER_WHERE,
                    },
                }),
            ]);

        const totalInvested = betsAggregate._sum.betAmount ?? 0;
        const totalWon = winsAggregate._sum.winAmount ?? 0;
        const totalBets = totalBetsCount;
        const netPL = totalInvested - totalWon;
        const winRate =
            totalBets > 0 ? (winningBetsCount / totalBets) * 100 : 0;
        const roi = totalInvested > 0 ? (netPL / totalInvested) * 100 : 0;

        return {
            gameName,
            totalBets,
            totalInvested,
            totalWon,
            winRate: Number(winRate.toFixed(2)),
            netPL,
            roi: Number(roi.toFixed(2)),
        };
    }

    // For other games with result models
    const [betsAggregate, winsAggregate, totalBetsCount] = await Promise.all([
        betModel.aggregate({
            where: {
                createdAt: {
                    gte: dateRange.start,
                    lte: dateRange.end,
                },
                user: REAL_USER_WHERE,
            },
            _sum: { betAmount: true },
            _count: true,
        }),
        resultModel.aggregate({
            where: {
                isWin: true,
                processedAt: {
                    gte: dateRange.start,
                    lte: dateRange.end,
                },
                bet: { user: REAL_USER_WHERE },
            },
            _sum: { winAmount: true },
        }),
        betModel.count({
            where: {
                createdAt: {
                    gte: dateRange.start,
                    lte: dateRange.end,
                },
                user: REAL_USER_WHERE,
            },
        }),
    ]);

    const totalInvested = betsAggregate._sum.betAmount ?? 0;
    const totalWon = winsAggregate._sum.winAmount ?? 0;
    const totalBets = totalBetsCount;
    const netPL = totalInvested - totalWon;

    // Calculate win rate (percentage of bets that won)
    const winningBetsCount = await resultModel.count({
        where: {
            isWin: true,
            processedAt: {
                gte: dateRange.start,
                lte: dateRange.end,
            },
            bet: { user: REAL_USER_WHERE },
        },
    });

    const winRate = totalBets > 0 ? (winningBetsCount / totalBets) * 100 : 0;

    // Calculate ROI (Return on Investment)
    const roi = totalInvested > 0 ? (netPL / totalInvested) * 100 : 0;

    return {
        gameName,
        totalBets,
        totalInvested,
        totalWon,
        winRate: Number(winRate.toFixed(2)),
        netPL,
        roi: Number(roi.toFixed(2)),
    };
}

export const profitLossRoutes = (app: OpenAPIHono) => {
    // Main profit and loss dashboard
    app.openapi(getProfitLossRoute, async (c) => {
        try {
            const { dateFilter } = c.req.valid("query");
            const dateRange = getDateRange(dateFilter);

            // Check cache
            const cacheKey = CacheKey.adminProfitLoss;
            const fieldKey = `dashboard:${dateFilter}`;

            const cachedData = await Cache.hget<ProfitLossData>(
                cacheKey,
                fieldKey
            );

            if (cachedData) {
                return c.json(
                    {
                        success: true,
                        data: cachedData,
                    },
                    HTTP_STATUS.OK
                );
            }

            // Calculate game statistics for all games
            const [
                wingoStats,
                trxStats,
                fiveDStats,
                k3Stats,
                motoStats,
                inoutStats,
            ] = await Promise.all([
                calculateGameStatistics("wingo", dateRange),
                calculateGameStatistics("trx", dateRange),
                calculateGameStatistics("5d", dateRange),
                calculateGameStatistics("k3", dateRange),
                calculateGameStatistics("moto", dateRange),
                calculateGameStatistics("inout", dateRange),
            ]);

            const gameStatistics = [
                wingoStats,
                trxStats,
                fiveDStats,
                k3Stats,
                motoStats,
                inoutStats,
            ];

            // Calculate aggregate card items
            const totalBets = gameStatistics.reduce(
                (sum, game) => sum + game.totalBets,
                0
            );
            const totalInvested = gameStatistics.reduce(
                (sum, game) => sum + game.totalInvested,
                0
            );
            const totalWon = gameStatistics.reduce(
                (sum, game) => sum + game.totalWon,
                0
            );

            // Count winning bets across all games
            const [
                wingoWins,
                trxWins,
                fiveDWins,
                k3Wins,
                motoWins,
                inoutWins,
            ] = await Promise.all([
                prisma.wingoBetResult.count({
                    where: {
                        isWin: true,
                        processedAt: {
                            gte: dateRange.start,
                            lte: dateRange.end,
                        },
                        bet: { user: REAL_USER_WHERE },
                    },
                }),
                prisma.trxWingoBetResult.count({
                    where: {
                        isWin: true,
                        processedAt: {
                            gte: dateRange.start,
                            lte: dateRange.end,
                        },
                        bet: { user: REAL_USER_WHERE },
                    },
                }),
                prisma.fiveDBetResult.count({
                    where: {
                        isWin: true,
                        processedAt: {
                            gte: dateRange.start,
                            lte: dateRange.end,
                        },
                        bet: { user: REAL_USER_WHERE },
                    },
                }),
                prisma.k3BetResult.count({
                    where: {
                        isWin: true,
                        processedAt: {
                            gte: dateRange.start,
                            lte: dateRange.end,
                        },
                        bet: { user: REAL_USER_WHERE },
                    },
                }),
                prisma.motoBetResult.count({
                    where: {
                        isWin: true,
                        processedAt: {
                            gte: dateRange.start,
                            lte: dateRange.end,
                        },
                        bet: { user: REAL_USER_WHERE },
                    },
                }),
                prisma.inoutBet.count({
                    where: {
                        createdAt: {
                            gte: dateRange.start,
                            lte: dateRange.end,
                        },
                        winAmount: { gt: 0 },
                        user: REAL_USER_WHERE,
                    },
                }),
            ]);

            const totalWins =
                wingoWins +
                trxWins +
                fiveDWins +
                k3Wins +
                motoWins +
                inoutWins;
            const totalLosses = totalBets - totalWins;
            const avgBet = totalBets > 0 ? totalInvested / totalBets : 0;
            const winRate = totalBets > 0 ? (totalWins / totalBets) * 100 : 0;
            const lossRate =
                totalBets > 0 ? (totalLosses / totalBets) * 100 : 0;
            const netPL = totalInvested - totalWon;
            const roi = totalInvested > 0 ? (netPL / totalInvested) * 100 : 0;

            // Win/Loss distribution
            const winLossDistribution = {
                totalWin: totalWon,
                totalLoss: totalInvested - totalWon,
            };

            const result: ProfitLossData = {
                dateFilter,
                cardItems: {
                    totalBets,
                    totalWins,
                    totalLosses,
                    totalInvested,
                    avgBet: Number(avgBet.toFixed(2)),
                    winRate: Number(winRate.toFixed(2)),
                    lossRate: Number(lossRate.toFixed(2)),
                    netPL,
                    roi: Number(roi.toFixed(2)),
                },
                winLossDistribution,
                gameStatistics,
            };

            // Cache for 2 minutes
            await Cache.hset(cacheKey, fieldKey, result, 60 * 2);

            return c.json(
                {
                    success: true,
                    data: result,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error(error);
            return apiError(
                c,
                "Internal server error",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    // Game-wise statistics endpoint
    app.openapi(getGameWiseStatisticsRoute, async (c) => {
        try {
            const { dateFilter } = c.req.valid("query");
            const dateRange = getDateRange(dateFilter);

            // Check cache
            const cacheKey = CacheKey.adminProfitLoss;
            const fieldKey = `game-stats:${dateFilter}`;

            const cachedData = await Cache.hget<
                z.infer<typeof gameStatisticsSchema>[]
            >(cacheKey, fieldKey);

            if (cachedData) {
                return c.json(
                    {
                        success: true,
                        data: cachedData,
                    },
                    HTTP_STATUS.OK
                );
            }

            // Calculate statistics for all games
            const [
                wingoStats,
                trxStats,
                fiveDStats,
                k3Stats,
                motoStats,
                inoutStats,
            ] = await Promise.all([
                calculateGameStatistics("wingo", dateRange),
                calculateGameStatistics("trx", dateRange),
                calculateGameStatistics("5d", dateRange),
                calculateGameStatistics("k3", dateRange),
                calculateGameStatistics("moto", dateRange),
                calculateGameStatistics("inout", dateRange),
            ]);

            const result = [
                wingoStats,
                trxStats,
                fiveDStats,
                k3Stats,
                motoStats,
                inoutStats,
            ];

            // Cache for 2 minutes
            await Cache.hset(cacheKey, fieldKey, result, 60 * 2);

            return c.json(
                {
                    success: true,
                    data: result,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error(error);
            return apiError(
                c,
                "Internal server error",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
