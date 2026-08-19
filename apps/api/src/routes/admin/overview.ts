import { createRoute, RouteConfig, OpenAPIHono, z } from "@hono/zod-openapi";

import { PaymentOrderStatus, WithdrawOrderStatus, prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { apiError, CommonResponses } from "@/lib/utils";
import { HTTP_STATUS } from "@/lib/http";
import { authCookie } from "@/schemas";
import { Cache, CacheKey } from "@bcwin/cache";
import {
    REAL_SUCCESS_DEPOSIT_WHERE,
    REAL_SUCCESS_WITHDRAW_WHERE,
    REAL_USER_RELATION,
    REAL_USER_WHERE,
} from "@/lib/realUserFilter";

const logger = new Logger("admin-overview");

const createAdminOverviewRoute = <T extends RouteConfig>(config: T) => {
    return createRoute({
        tags: ["admin"],
        ...config,
    });
};

const overviewCategorySchema = z.object({
    todayAmount: z.number().openapi({
        description:
            "SUCCESS amount today for real USERs (not pending / failed / staff / demo).",
        example: 5000,
    }),
    pendingAmount: z.number().openapi({
        description: "Total amount of all pending transactions.",
        example: 1200,
    }),
    successAmount: z.number().openapi({
        description: "Total amount of all successful transactions.",
        example: 25000,
    }),
    failedAmount: z.number().openapi({
        description: "Total amount of all failed transactions.",
        example: 300,
    }),
    totalAmount: z.number().openapi({
        description: "Total amount of all transactions (all time).",
        example: 50000,
    }),
});

// The main response schema for the entire overview
const adminOverviewResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the admin overview retrieval was successful",
        example: true,
    }),
    data: z.object({
        users: z.object({
            totalCount: z.number().openapi({
                description: "The total number of registered users.",
                example: 1500,
            }),
            activeCount: z.number().openapi({
                description:
                    "The number of active users (placed bet within last 1 week).",
                example: 450,
            }),
            todayCount: z.number().openapi({
                description: "The number of users who registered today.",
                example: 25,
            }),
            totalBalance: z.number().openapi({
                description: "The sum of all user balances.",
                example: 125000.75,
            }),
        }),
        deposits: overviewCategorySchema,
        withdrawals: overviewCategorySchema,
        bets: z.object({
            totalBet: z.number().openapi({
                description: "Total bet amount placed (all time).",
                example: 500000,
            }),
            totalWin: z.number().openapi({
                description: "Total win amount paid out (all time).",
                example: 450000,
            }),
            profit: z.number().openapi({
                description: "All-time platform profit (bet - win).",
                example: 50000,
            }),
            todayTotalBet: z.number().openapi({
                description: "Total bet amount placed today.",
                example: 15000,
            }),
            todayTotalWin: z.number().openapi({
                description: "Total win amount paid out today.",
                example: 12000,
            }),
            todayProfit: z.number().openapi({
                description: "Today's platform profit (bet - win).",
                example: 3000,
            }),
        }),
    }),
});

const GetAdminOverviewRoute = createAdminOverviewRoute({
    method: "get",
    path: "/overview",
    summary: "Get the admin overview",
    description:
        "Platform totals for real USERs only (not demo / admin / agent). Today’s recharge and withdraw are SUCCESS only. Pending stays on pendingAmount.",
    request: {
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: adminOverviewResponseSchema,
                },
            },
            description: "Admin overview retrieved successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

type AdminOverviewData = z.infer<typeof adminOverviewResponseSchema>["data"];

export const overviewRoutes = (app: OpenAPIHono) => {
    app.openapi(GetAdminOverviewRoute, async (c) => {
        try {
            const cachedData = await Cache.get<AdminOverviewData>(
                CacheKey.adminOverview
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

            const startOfToday = new Date();
            startOfToday.setHours(0, 0, 0, 0);

            const oneWeekAgo = new Date();
            oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

            const [
                totalUsers,
                todayUsers,
                totalBalanceResult,
                depositGroups,
                todayDepositResult,
                withdrawGroups,
                todayWithdrawResult,
                activeUsersWingo,
                activeUsersFiveD,
                activeUsersK3,
                activeUsersMoto,
                activeUsersTrxWingo,
                activeUsersInout,
                // All-time bets
                allWingoBets,
                allFiveDBets,
                allK3Bets,
                allMotoBets,
                allTrxWingoBets,
                allInoutBets,
                // All-time wins
                allWingoWins,
                allFiveDWins,
                allK3Wins,
                allMotoWins,
                allTrxWingoWins,
                allInoutWins,
                // Today's bets
                todayWingoBets,
                todayFiveDBets,
                todayK3Bets,
                todayMotoBets,
                todayTrxWingoBets,
                todayInoutBets,
                // Today's wins
                todayWingoWins,
                todayFiveDWins,
                todayK3Wins,
                todayMotoWins,
                todayTrxWingoWins,
                todayInoutWins,
            ] = await Promise.all([
                prisma.user.count({
                    where: REAL_USER_WHERE,
                }),
                prisma.user.count({
                    where: { createdAt: { gte: startOfToday }, ...REAL_USER_WHERE },
                }),
                prisma.user.aggregate({
                    where: REAL_USER_WHERE,
                    _sum: { balance: true },
                }),

                prisma.deposit.groupBy({
                    by: ["status"],
                    where: { ...REAL_USER_RELATION },
                    _sum: { amount: true },
                }),
                prisma.deposit.aggregate({
                    where: {
                        createdAt: { gte: startOfToday },
                        ...REAL_SUCCESS_DEPOSIT_WHERE,
                    },
                    _sum: { amount: true },
                }),

                prisma.withdraw.groupBy({
                    by: ["status"],
                    where: { ...REAL_USER_RELATION },
                    _sum: { amount: true },
                }),
                prisma.withdraw.aggregate({
                    where: {
                        createdAt: { gte: startOfToday },
                        ...REAL_SUCCESS_WITHDRAW_WHERE,
                    },
                    _sum: { amount: true },
                }),

                // Active users (placed bets in last 7 days) - get distinct user IDs from each game
                prisma.wingoBet.findMany({
                    where: { createdAt: { gte: oneWeekAgo }, ...REAL_USER_RELATION },
                    select: { userId: true },
                    distinct: ["userId"],
                }),
                prisma.fiveDBet.findMany({
                    where: { createdAt: { gte: oneWeekAgo }, ...REAL_USER_RELATION },
                    select: { userId: true },
                    distinct: ["userId"],
                }),
                prisma.k3Bet.findMany({
                    where: { createdAt: { gte: oneWeekAgo }, ...REAL_USER_RELATION },
                    select: { userId: true },
                    distinct: ["userId"],
                }),
                prisma.motoBet.findMany({
                    where: { createdAt: { gte: oneWeekAgo }, ...REAL_USER_RELATION },
                    select: { userId: true },
                    distinct: ["userId"],
                }),
                prisma.trxWingoBet.findMany({
                    where: { createdAt: { gte: oneWeekAgo }, ...REAL_USER_RELATION },
                    select: { userId: true },
                    distinct: ["userId"],
                }),
                prisma.inoutBet.findMany({
                    where: { createdAt: { gte: oneWeekAgo }, ...REAL_USER_RELATION },
                    select: { userId: true },
                    distinct: ["userId"],
                }),

                // All-time total bets
                prisma.wingoBet.aggregate({
                    where: { ...REAL_USER_RELATION },
                    _sum: { betAmount: true },
                }),
                prisma.fiveDBet.aggregate({
                    where: { ...REAL_USER_RELATION },
                    _sum: { betAmount: true },
                }),
                prisma.k3Bet.aggregate({
                    where: { ...REAL_USER_RELATION },
                    _sum: { betAmount: true },
                }),
                prisma.motoBet.aggregate({
                    where: { ...REAL_USER_RELATION },
                    _sum: { betAmount: true },
                }),
                prisma.trxWingoBet.aggregate({
                    where: { ...REAL_USER_RELATION },
                    _sum: { betAmount: true },
                }),
                prisma.inoutBet.aggregate({
                    where: { ...REAL_USER_RELATION },
                    _sum: { betAmount: true },
                }),

                // All-time total wins
                prisma.wingoBetResult.aggregate({
                    where: { isWin: true, bet: { ...REAL_USER_RELATION } },
                    _sum: { winAmount: true },
                }),
                prisma.fiveDBetResult.aggregate({
                    where: { isWin: true, bet: { ...REAL_USER_RELATION } },
                    _sum: { winAmount: true },
                }),
                prisma.k3BetResult.aggregate({
                    where: { isWin: true, bet: { ...REAL_USER_RELATION } },
                    _sum: { winAmount: true },
                }),
                prisma.motoBetResult.aggregate({
                    where: { isWin: true, bet: { ...REAL_USER_RELATION } },
                    _sum: { winAmount: true },
                }),
                prisma.trxWingoBetResult.aggregate({
                    where: { isWin: true, bet: { ...REAL_USER_RELATION } },
                    _sum: { winAmount: true },
                }),
                prisma.inoutBet.aggregate({
                    where: { winAmount: { gt: 0 }, ...REAL_USER_RELATION },
                    _sum: { winAmount: true },
                }),

                // Today's total bets
                prisma.wingoBet.aggregate({
                    where: { createdAt: { gte: startOfToday }, ...REAL_USER_RELATION },
                    _sum: { betAmount: true },
                }),
                prisma.fiveDBet.aggregate({
                    where: { createdAt: { gte: startOfToday }, ...REAL_USER_RELATION },
                    _sum: { betAmount: true },
                }),
                prisma.k3Bet.aggregate({
                    where: { createdAt: { gte: startOfToday }, ...REAL_USER_RELATION },
                    _sum: { betAmount: true },
                }),
                prisma.motoBet.aggregate({
                    where: { createdAt: { gte: startOfToday }, ...REAL_USER_RELATION },
                    _sum: { betAmount: true },
                }),
                prisma.trxWingoBet.aggregate({
                    where: { createdAt: { gte: startOfToday }, ...REAL_USER_RELATION },
                    _sum: { betAmount: true },
                }),
                prisma.inoutBet.aggregate({
                    where: { createdAt: { gte: startOfToday }, ...REAL_USER_RELATION },
                    _sum: { betAmount: true },
                }),

                // Today's total wins
                prisma.wingoBetResult.aggregate({
                    where: {
                        processedAt: { gte: startOfToday },
                        isWin: true,
                        bet: { ...REAL_USER_RELATION },
                    },
                    _sum: { winAmount: true },
                }),
                prisma.fiveDBetResult.aggregate({
                    where: {
                        processedAt: { gte: startOfToday },
                        isWin: true,
                        bet: { ...REAL_USER_RELATION },
                    },
                    _sum: { winAmount: true },
                }),
                prisma.k3BetResult.aggregate({
                    where: {
                        processedAt: { gte: startOfToday },
                        isWin: true,
                        bet: { ...REAL_USER_RELATION },
                    },
                    _sum: { winAmount: true },
                }),
                prisma.motoBetResult.aggregate({
                    where: {
                        processedAt: { gte: startOfToday },
                        isWin: true,
                        bet: { ...REAL_USER_RELATION },
                    },
                    _sum: { winAmount: true },
                }),
                prisma.trxWingoBetResult.aggregate({
                    where: {
                        processedAt: { gte: startOfToday },
                        isWin: true,
                        bet: { ...REAL_USER_RELATION },
                    },
                    _sum: { winAmount: true },
                }),
                prisma.inoutBet.aggregate({
                    where: {
                        createdAt: { gte: startOfToday },
                        winAmount: { gt: 0 },
                        ...REAL_USER_RELATION,
                    },
                    _sum: { winAmount: true },
                }),
            ]);

            // Calculate active users count (unique users across all games)
            const activeUserIds = new Set([
                ...activeUsersWingo.map((u) => u.userId),
                ...activeUsersFiveD.map((u) => u.userId),
                ...activeUsersK3.map((u) => u.userId),
                ...activeUsersMoto.map((u) => u.userId),
                ...activeUsersTrxWingo.map((u) => u.userId),
                ...activeUsersInout.map((u) => u.userId),
            ]);
            const activeUsersCount = activeUserIds.size;

            // Calculate all-time total bets and wins
            const totalBet =
                (allWingoBets._sum.betAmount ?? 0) +
                (allFiveDBets._sum.betAmount ?? 0) +
                (allK3Bets._sum.betAmount ?? 0) +
                (allMotoBets._sum.betAmount ?? 0) +
                (allTrxWingoBets._sum.betAmount ?? 0) +
                (allInoutBets._sum.betAmount ?? 0);

            const totalWin =
                (allWingoWins._sum.winAmount ?? 0) +
                (allFiveDWins._sum.winAmount ?? 0) +
                (allK3Wins._sum.winAmount ?? 0) +
                (allMotoWins._sum.winAmount ?? 0) +
                (allTrxWingoWins._sum.winAmount ?? 0) +
                (allInoutWins._sum.winAmount ?? 0);

            const profit = totalBet - totalWin;

            // Calculate today's total bets and wins
            const todayTotalBet =
                (todayWingoBets._sum.betAmount ?? 0) +
                (todayFiveDBets._sum.betAmount ?? 0) +
                (todayK3Bets._sum.betAmount ?? 0) +
                (todayMotoBets._sum.betAmount ?? 0) +
                (todayTrxWingoBets._sum.betAmount ?? 0) +
                (todayInoutBets._sum.betAmount ?? 0);

            const todayTotalWin =
                (todayWingoWins._sum.winAmount ?? 0) +
                (todayFiveDWins._sum.winAmount ?? 0) +
                (todayK3Wins._sum.winAmount ?? 0) +
                (todayMotoWins._sum.winAmount ?? 0) +
                (todayTrxWingoWins._sum.winAmount ?? 0) +
                (todayInoutWins._sum.winAmount ?? 0);

            const todayProfit = todayTotalBet - todayTotalWin;

            const depositData = depositGroups.reduce(
                (acc, group) => {
                    const status = group.status;
                    const sum = group._sum.amount ?? 0;
                    acc.totalAmount += sum;
                    if (status === PaymentOrderStatus.SUCCESS)
                        acc.successAmount += sum;
                    if (status === PaymentOrderStatus.FAILED)
                        acc.failedAmount += sum;
                    if (status === PaymentOrderStatus.PROCESSING)
                        acc.pendingAmount += sum;
                    return acc;
                },
                {
                    successAmount: 0,
                    failedAmount: 0,
                    pendingAmount: 0,
                    totalAmount: 0,
                }
            );

            const withdrawalData = withdrawGroups.reduce(
                (acc, group) => {
                    const status = group.status;
                    const sum = group._sum.amount ?? 0;
                    acc.totalAmount += sum;
                    if (status === WithdrawOrderStatus.SUCCESS)
                        acc.successAmount += sum;
                    if (status === WithdrawOrderStatus.FAILED)
                        acc.failedAmount += sum;
                    if (
                        status === WithdrawOrderStatus.PROCESSING ||
                        status === WithdrawOrderStatus.GENERATED
                    ) {
                        acc.pendingAmount += sum;
                    }
                    return acc;
                },
                {
                    successAmount: 0,
                    failedAmount: 0,
                    pendingAmount: 0,
                    totalAmount: 0,
                }
            );

            const response = {
                success: true,
                data: {
                    users: {
                        totalCount: totalUsers,
                        activeCount: activeUsersCount,
                        todayCount: todayUsers,
                        totalBalance: totalBalanceResult._sum.balance ?? 0,
                    },
                    deposits: {
                        todayAmount: todayDepositResult._sum.amount ?? 0,
                        pendingAmount: depositData.pendingAmount,
                        successAmount: depositData.successAmount,
                        failedAmount: depositData.failedAmount,
                        totalAmount: depositData.totalAmount,
                    },
                    withdrawals: {
                        todayAmount: todayWithdrawResult._sum.amount ?? 0,
                        pendingAmount: withdrawalData.pendingAmount,
                        successAmount: withdrawalData.successAmount,
                        failedAmount: withdrawalData.failedAmount,
                        totalAmount: withdrawalData.totalAmount,
                    },
                    bets: {
                        totalBet,
                        totalWin,
                        profit,
                        todayTotalBet,
                        todayTotalWin,
                        todayProfit,
                    },
                },
            };

            await Cache.set<AdminOverviewData>(
                CacheKey.adminOverview,
                response.data,
                60 * 2 // 2 minutes
            );

            return c.json(response, HTTP_STATUS.OK);
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
