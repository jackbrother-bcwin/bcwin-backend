import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { prisma, Prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { apiError, CommonResponses } from "@/lib/utils";
import { HTTP_STATUS } from "@/lib/http";
import { authCookie } from "@/schemas";
import { Cache, CacheKey } from "@bcwin/cache";
import { REAL_USER_WHERE } from "@/lib/realUserFilter";

const logger = new Logger("admin-top-performance");

// Date filter type
const timeFilterSchema = z
    .enum(["all_time", "this_week", "this_month", "this_year"])
    .openapi({
        description: "Time filter for top performance data",
        example: "all_time",
    });

// Date range utility functions
function getDateRange(filter: string): { start: Date | null; end: Date } {
    const now = new Date();
    const start = new Date();
    const end = new Date();

    switch (filter) {
        case "all_time":
            return { start: null, end: now };

        case "this_week": {
            const dayOfWeek = now.getDay();
            const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Monday
            const monday = new Date(now);
            monday.setDate(diff);
            start.setTime(monday.getTime());
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);
            return { start, end };
        }

        case "this_month": {
            start.setDate(1);
            start.setHours(0, 0, 0, 0);
            const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            end.setTime(lastDay.getTime());
            end.setHours(23, 59, 59, 999);
            return { start, end };
        }

        case "this_year": {
            start.setMonth(0, 1);
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);
            return { start, end };
        }

        default:
            return { start: null, end: now };
    }
}

// Top performer schema
const topPerformerSchema = z.object({
    username: z.string().openapi({
        description: "Player username",
        example: "player123",
    }),
    mobile: z.string().openapi({
        description: "Player mobile number",
        example: "9876543210",
    }),
    status: z.string().openapi({
        description: "Player status (active/banned)",
        example: "active",
    }),
    totalDeposits: z.number().openapi({
        description: "Total deposits",
        example: 50000.0,
    }),
    totalWithdrawals: z.number().openapi({
        description: "Total withdrawals",
        example: 30000.0,
    }),
    bettingActivity: z.number().openapi({
        description: "Total number of bets",
        example: 1500,
    }),
    currentBalance: z.number().openapi({
        description: "Current wallet balance",
        example: 10000.0,
    }),
    avgBetSize: z.number().openapi({
        description: "Average bet size",
        example: 50.0,
    }),
    activityScore: z.number().openapi({
        description: "Activity score (composite metric)",
        example: 85.5,
    }),
    retentionRate: z.number().openapi({
        description: "Retention rate percentage",
        example: 75.5,
    }),
    netProfit: z.number().openapi({
        description: "Net profit (deposits - withdrawals)",
        example: 20000.0,
    }),
});

// Card items schema
const cardItemsSchema = z.object({
    totalDeposits: z.number().openapi({
        description: "Total deposits of top 3 performers",
        example: 150000.0,
    }),
    averageROI: z.number().openapi({
        description: "Average ROI of top 3 performers",
        example: 15.5,
    }),
    totalBets: z.number().openapi({
        description: "Total bets of top 3 performers",
        example: 4500,
    }),
    avgWinRate: z.number().openapi({
        description: "Average win rate of top 3 performers",
        example: 65.5,
    }),
});

// Main top performance response schema
const topPerformanceResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    data: z.object({
        timeFilter: z.string().openapi({
            description: "Applied time filter",
            example: "all_time",
        }),
        cardItems: cardItemsSchema,
        topPerformers: z.array(topPerformerSchema),
    }),
});

const getTopPerformanceRoute = createRoute({
    method: "get",
    path: "/",
    tags: ["admin"],
    summary: "Get top performing players",
    description:
        "Get top 3 performing players with time filters (all time, this week, this month, this year) including card items and detailed player metrics",
    request: {
        query: z.object({
            timeFilter: timeFilterSchema.optional().default("all_time"),
        }),
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: topPerformanceResponseSchema,
                },
            },
            description: "Top performance data retrieved successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

type TopPerformanceData = z.infer<typeof topPerformanceResponseSchema>["data"];

// Helper function to calculate activity score
// Based on: betting frequency, deposit frequency, recent activity
function calculateActivityScore(
    totalBets: number,
    totalDeposits: number,
    daysSinceFirstActivity: number,
    recentActivityDays: number
): number {
    // Normalize factors (0-100 scale)
    const bettingScore = Math.min((totalBets / 1000) * 50, 50); // Max 50 points for betting
    const depositScore = Math.min((totalDeposits / 100000) * 30, 30); // Max 30 points for deposits
    const recencyScore = Math.min((recentActivityDays / 30) * 20, 20); // Max 20 points for recent activity

    // Combine scores
    const score = bettingScore + depositScore + recencyScore;
    return Math.min(score, 100); // Cap at 100
}

// Helper function to calculate retention rate for a user
// Based on: recent activity and account age
async function calculateRetentionRate(
    userId: string,
    dateRange: { start: Date | null; end: Date }
): Promise<number> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { createdAt: true },
    });

    if (!user) return 0;

    const startDate = dateRange.start || user.createdAt;
    const daysSinceStart =
        Math.floor(
            (dateRange.end.getTime() - startDate.getTime()) /
            (1000 * 60 * 60 * 24)
        ) || 1;

    // Check if user was active in the last 7 days
    const sevenDaysAgo = new Date(dateRange.end);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentActivity = await prisma.user.findFirst({
        where: {
            id: userId,
            OR: [
                {
                    wingoBets: {
                        some: { createdAt: { gte: sevenDaysAgo } },
                    },
                },
                {
                    fiveDBets: {
                        some: { createdAt: { gte: sevenDaysAgo } },
                    },
                },
                {
                    k3Bets: {
                        some: { createdAt: { gte: sevenDaysAgo } },
                    },
                },
                {
                    motoBets: {
                        some: { createdAt: { gte: sevenDaysAgo } },
                    },
                },
                {
                    trxwingoBets: {
                        some: { createdAt: { gte: sevenDaysAgo } },
                    },
                },
            ],
        },
    });

    if (!recentActivity) return 0;

    // Calculate retention based on account age and recent activity
    // Newer accounts with activity get higher retention
    // Older accounts need consistent activity
    if (daysSinceStart <= 30) {
        // New account: high retention if active
        return recentActivity ? 90 : 0;
    } else if (daysSinceStart <= 90) {
        // Medium age: moderate retention
        return recentActivity ? 70 : 0;
    } else {
        // Old account: lower base retention, but still good if active
        return recentActivity ? 60 : 0;
    }
}

export const topPerformanceRoutes = (app: OpenAPIHono) => {
    app.openapi(getTopPerformanceRoute, async (c) => {
        try {
            const { timeFilter } = c.req.valid("query");
            const dateRange = getDateRange(timeFilter);

            // Check cache
            const cacheKey = CacheKey.adminTopPerformance;
            const fieldKey = `top-performance:${timeFilter}`;

            const cachedData = await Cache.hget<TopPerformanceData>(
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

            // Build date filter for queries
            const dateFilter: any = {};
            if (dateRange.start) {
                dateFilter.gte = dateRange.start;
            }
            dateFilter.lte = dateRange.end;

            // Get all users and calculate their performance metrics
            const users = await prisma.user.findMany({
                where: REAL_USER_WHERE,
                select: {
                    id: true,
                    username: true,
                    mobileNumber: true,
                    isBanned: true,
                    balance: true,
                    createdAt: true,
                },
            });

            // Calculate performance metrics for each user
            const userPerformanceData = await Promise.all(
                users.map(async (user) => {
                    const [
                        deposits,
                        withdrawals,
                        wingoBets,
                        fiveDBets,
                        k3Bets,
                        motoBets,
                        trxWingoBets,
                        inoutBets,
                        wingoWins,
                        fiveDWins,
                        k3Wins,
                        motoWins,
                        trxWingoWins,
                    ] = await Promise.all([
                        prisma.deposit.aggregate({
                            where: {
                                userId: user.id,
                                status: "SUCCESS",
                                createdAt: dateFilter,
                            },
                            _sum: { amount: true },
                        }),
                        prisma.withdraw.aggregate({
                            where: {
                                userId: user.id,
                                status: "SUCCESS",
                                createdAt: dateFilter,
                            },
                            _sum: { amount: true },
                        }),
                        prisma.wingoBet.aggregate({
                            where: {
                                userId: user.id,
                                createdAt: dateFilter,
                            },
                            _sum: { betAmount: true },
                            _count: true,
                        }),
                        prisma.fiveDBet.aggregate({
                            where: {
                                userId: user.id,
                                createdAt: dateFilter,
                            },
                            _sum: { betAmount: true },
                            _count: true,
                        }),
                        prisma.k3Bet.aggregate({
                            where: {
                                userId: user.id,
                                createdAt: dateFilter,
                            },
                            _sum: { betAmount: true },
                            _count: true,
                        }),
                        prisma.motoBet.aggregate({
                            where: {
                                userId: user.id,
                                createdAt: dateFilter,
                            },
                            _sum: { betAmount: true },
                            _count: true,
                        }),
                        prisma.trxWingoBet.aggregate({
                            where: {
                                userId: user.id,
                                createdAt: dateFilter,
                            },
                            _sum: { betAmount: true },
                            _count: true,
                        }),
                        prisma.inoutBet.aggregate({
                            where: {
                                userId: user.id,
                                createdAt: dateFilter,
                            },
                            _sum: { betAmount: true },
                            _count: true,
                        }),
                        prisma.wingoBetResult.aggregate({
                            where: {
                                bet: { userId: user.id },
                                isWin: true,
                                processedAt: dateFilter,
                            },
                            _sum: { winAmount: true },
                        }),
                        prisma.fiveDBetResult.aggregate({
                            where: {
                                bet: { userId: user.id },
                                isWin: true,
                                processedAt: dateFilter,
                            },
                            _sum: { winAmount: true },
                        }),
                        prisma.k3BetResult.aggregate({
                            where: {
                                bet: { userId: user.id },
                                isWin: true,
                                processedAt: dateFilter,
                            },
                            _sum: { winAmount: true },
                        }),
                        prisma.motoBetResult.aggregate({
                            where: {
                                bet: { userId: user.id },
                                isWin: true,
                                processedAt: dateFilter,
                            },
                            _sum: { winAmount: true },
                        }),
                        prisma.trxWingoBetResult.aggregate({
                            where: {
                                bet: { userId: user.id },
                                isWin: true,
                                processedAt: dateFilter,
                            },
                            _sum: { winAmount: true },
                        }),
                    ]);

                    const totalDeposits = deposits._sum.amount ?? 0;
                    const totalWithdrawals = withdrawals._sum.amount ?? 0;
                    const totalBetAmount =
                        (wingoBets._sum.betAmount ?? 0) +
                        (fiveDBets._sum.betAmount ?? 0) +
                        (k3Bets._sum.betAmount ?? 0) +
                        (motoBets._sum.betAmount ?? 0) +
                        (trxWingoBets._sum.betAmount ?? 0) +
                        (inoutBets._sum.betAmount ?? 0);
                    const totalBets =
                        (wingoBets._count ?? 0) +
                        (fiveDBets._count ?? 0) +
                        (k3Bets._count ?? 0) +
                        (motoBets._count ?? 0) +
                        (trxWingoBets._count ?? 0) +
                        (inoutBets._count ?? 0);
                    const totalWinAmount =
                        (wingoWins._sum?.winAmount ?? 0) +
                        (fiveDWins._sum?.winAmount ?? 0) +
                        (k3Wins._sum?.winAmount ?? 0) +
                        (motoWins._sum?.winAmount ?? 0) +
                        (trxWingoWins._sum?.winAmount ?? 0);

                    // Calculate winning bets count
                    const winningBetsCount = await Promise.all([
                        prisma.wingoBetResult.count({
                            where: {
                                bet: { userId: user.id },
                                isWin: true,
                                processedAt: dateFilter,
                            },
                        }),
                        prisma.fiveDBetResult.count({
                            where: {
                                bet: { userId: user.id },
                                isWin: true,
                                processedAt: dateFilter,
                            },
                        }),
                        prisma.k3BetResult.count({
                            where: {
                                bet: { userId: user.id },
                                isWin: true,
                                processedAt: dateFilter,
                            },
                        }),
                        prisma.motoBetResult.count({
                            where: {
                                bet: { userId: user.id },
                                isWin: true,
                                processedAt: dateFilter,
                            },
                        }),
                        prisma.trxWingoBetResult.count({
                            where: {
                                bet: { userId: user.id },
                                isWin: true,
                                processedAt: dateFilter,
                            },
                        }),
                        prisma.inoutBet.count({
                            where: {
                                userId: user.id,
                                createdAt: dateFilter,
                                winAmount: { gt: 0 },
                            },
                        }),
                    ]);

                    const totalWinningBets = winningBetsCount.reduce(
                        (sum, count) => sum + count,
                        0
                    );

                    const winRate =
                        totalBets > 0
                            ? (totalWinningBets / totalBets) * 100
                            : 0;
                    const netProfit = totalBetAmount - totalWinAmount;
                    const avgBetSize =
                        totalBets > 0 ? totalBetAmount / totalBets : 0;
                    const roi =
                        totalBetAmount > 0
                            ? (netProfit / totalBetAmount) * 100
                            : 0;

                    // Calculate activity score
                    const daysSinceStart = dateRange.start
                        ? Math.floor(
                            (dateRange.end.getTime() -
                                dateRange.start.getTime()) /
                            (1000 * 60 * 60 * 24)
                        )
                        : Math.floor(
                            (dateRange.end.getTime() -
                                user.createdAt.getTime()) /
                            (1000 * 60 * 60 * 24)
                        );

                    // Check recent activity (last 7 days)
                    const sevenDaysAgo = new Date(dateRange.end);
                    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
                    const recentBets = await prisma.wingoBet.count({
                        where: {
                            userId: user.id,
                            createdAt: {
                                gte: sevenDaysAgo,
                                lte: dateRange.end,
                            },
                        },
                    });

                    const activityScore = calculateActivityScore(
                        totalBets,
                        totalDeposits,
                        daysSinceStart || 1,
                        recentBets
                    );

                    // Calculate retention rate
                    const retentionRate = await calculateRetentionRate(
                        user.id,
                        dateRange
                    );

                    return {
                        userId: user.id,
                        username: user.username,
                        mobile: user.mobileNumber,
                        status: user.isBanned ? "banned" : "active",
                        totalDeposits,
                        totalWithdrawals,
                        bettingActivity: totalBets,
                        currentBalance: user.balance,
                        avgBetSize,
                        activityScore: Number(activityScore.toFixed(2)),
                        retentionRate: Number(retentionRate.toFixed(2)),
                        netProfit,
                        winRate: Number(winRate.toFixed(2)),
                        roi: Number(roi.toFixed(2)),
                    };
                })
            );

            // Sort by net profit (or could use activity score)
            userPerformanceData.sort((a, b) => b.netProfit - a.netProfit);

            // Get top 3
            const top3 = userPerformanceData.slice(0, 3);

            // Calculate card items (aggregate of top 3)
            const cardItems = {
                totalDeposits: top3.reduce(
                    (sum, p) => sum + p.totalDeposits,
                    0
                ),
                averageROI:
                    top3.length > 0
                        ? top3.reduce((sum, p) => sum + p.roi, 0) / top3.length
                        : 0,
                totalBets: top3.reduce((sum, p) => sum + p.bettingActivity, 0),
                avgWinRate:
                    top3.length > 0
                        ? top3.reduce((sum, p) => sum + p.winRate, 0) /
                        top3.length
                        : 0,
            };

            const result: TopPerformanceData = {
                timeFilter,
                cardItems: {
                    totalDeposits: Number(cardItems.totalDeposits.toFixed(2)),
                    averageROI: Number(cardItems.averageROI.toFixed(2)),
                    totalBets: cardItems.totalBets,
                    avgWinRate: Number(cardItems.avgWinRate.toFixed(2)),
                },
                topPerformers: top3.map((p) => ({
                    username: p.username,
                    mobile: p.mobile,
                    status: p.status,
                    totalDeposits: p.totalDeposits,
                    totalWithdrawals: p.totalWithdrawals,
                    bettingActivity: p.bettingActivity,
                    currentBalance: p.currentBalance,
                    avgBetSize: Number(p.avgBetSize.toFixed(2)),
                    activityScore: p.activityScore,
                    retentionRate: p.retentionRate,
                    netProfit: p.netProfit,
                })),
            };

            // Cache for 5 minutes
            await Cache.hset(cacheKey, fieldKey, result, 60 * 5);

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
