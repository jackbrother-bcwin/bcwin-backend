import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import Logger from "@bcwin/logger";
import {
    ADMIN_USER_IDENTITY_SELECT,
    mapAdminUserIdentity,
} from "@/lib/adminUserIdentity";
import { HTTP_STATUS } from "@/lib/http";
import { parseYmdStartIst, shiftYmdIst, ymdIst } from "@/lib/istDate";
import { REAL_USER_WHERE } from "@/lib/realUserFilter";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";

const logger = new Logger("admin-dashboard-insights");

const userIdentitySchema = z.object({
    id: z.string(),
    serialNumber: z.number(),
    username: z.string(),
    mobileNumber: z.string(),
    email: z.string().nullable(),
    bank: z.object({ fullName: z.string().nullable() }).nullable(),
});

const getLiveWingoRoute = createRoute({
    method: "get",
    path: "/dashboard/wingo-live",
    tags: ["admin"],
    summary: "Current WinGo 30-second and 1-minute betting snapshots",
    request: { cookies: authCookie },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        periods: z.array(
                            z.object({
                                id: z.string(),
                                periodNumber: z.string(),
                                durationSeconds: z.number(),
                                startTime: z.string(),
                                endTime: z.string(),
                                betCount: z.number(),
                                totalBetAmount: z.number(),
                                selections: z.array(
                                    z.object({
                                        betType: z.string(),
                                        betChoice: z.string(),
                                        betCount: z.number(),
                                        amount: z.number(),
                                    })
                                ),
                            })
                        ),
                    }),
                },
            },
            description: "Live WinGo period betting snapshots",
        },
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

const dashboardEarningsSchema = z.object({
    allTimeRebateCommission: z.number(),
    todayRebateCommission: z.number(),
    allTimeSalary: z.number(),
    todaySalary: z.number(),
    updatedAt: z.string(),
});

const getDashboardEarningsRoute = createRoute({
    method: "get",
    path: "/dashboard/earnings",
    tags: ["admin"],
    summary: "Live settled rebate commission and paid salary totals",
    request: { cookies: authCookie },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        earnings: dashboardEarningsSchema,
                    }),
                },
            },
            description:
                "All-time settled rebate, current IST-day unsettled rebate, and paid salary totals for real users",
        },
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

const getRecentWingoBetsRoute = createRoute({
    method: "get",
    path: "/dashboard/wingo-bets",
    tags: ["admin"],
    summary: "Last 50 settled WinGo bets",
    request: { cookies: authCookie },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        bets: z.array(
                            z.object({
                                id: z.string(),
                                user: userIdentitySchema,
                                periodNumber: z.string(),
                                durationSeconds: z.number(),
                                betType: z.string(),
                                betChoice: z.string(),
                                betAmount: z.number(),
                                resultNumber: z.number().nullable(),
                                resultColor: z.string().nullable(),
                                resultSize: z.string().nullable(),
                                status: z.enum(["WON", "LOST"]),
                                winAmount: z.number(),
                                placedAt: z.string(),
                                settledAt: z.string(),
                            })
                        ),
                    }),
                },
            },
            description: "Most recently settled WinGo bets",
        },
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

const getTopUsersRoute = createRoute({
    method: "get",
    path: "/dashboard/top-users",
    tags: ["admin"],
    summary: "Top 100 real users by balance or successful withdrawals",
    request: {
        cookies: authCookie,
        query: z.object({
            sort: z.enum(["balance", "withdrawals"]).default("balance"),
        }),
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        sort: z.enum(["balance", "withdrawals"]),
                        users: z.array(
                            z.object({
                                rank: z.number(),
                                user: userIdentitySchema,
                                balance: z.number(),
                                successfulWithdrawAmount: z.number(),
                                successfulWithdrawCount: z.number(),
                                isBanned: z.boolean(),
                            })
                        ),
                    }),
                },
            },
            description: "Ranked real-user list",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

const liveGameSchema = z.enum(["wingo", "trxwingo", "k3", "5d", "moto"]);

const getGameLiveBetsRoute = createRoute({
    method: "get",
    path: "/dashboard/game-live-bets",
    tags: ["admin"],
    summary: "Current-period live bet book for an admin game manager",
    request: {
        cookies: authCookie,
        query: z.object({
            game: liveGameSchema,
            periodId: z.string().uuid(),
        }),
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        game: liveGameSchema,
                        periodId: z.string(),
                        total: z.number(),
                        totalBetAmount: z.number(),
                        distribution: z.array(
                            z.object({
                                betType: z.string(),
                                betChoice: z.string(),
                                betCount: z.number(),
                                amount: z.number(),
                            })
                        ),
                        bets: z.array(
                            z.object({
                                id: z.string(),
                                user: userIdentitySchema,
                                betType: z.string(),
                                betChoice: z.string(),
                                betAmount: z.number(),
                                status: z.literal("PENDING"),
                                createdAt: z.string(),
                            })
                        ),
                    }),
                },
            },
            description:
                "Uncached current-period totals, distribution, and newest 100 bets",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

type LiveBookDistribution = {
    betType: string;
    betChoice: string;
    betCount: number;
    amount: number;
};

type LiveBookBet = {
    id: string;
    user: ReturnType<typeof mapAdminUserIdentity>;
    betType: string;
    betChoice: string;
    betAmount: number;
    status: "PENDING";
    createdAt: string;
};

function liveBookPayload(
    game: "wingo" | "trxwingo" | "k3" | "5d" | "moto",
    periodId: string,
    distribution: LiveBookDistribution[],
    bets: LiveBookBet[]
) {
    const sortedDistribution = distribution.sort(
        (a, b) =>
            b.amount - a.amount ||
            a.betType.localeCompare(b.betType) ||
            a.betChoice.localeCompare(b.betChoice)
    );
    return {
        success: true as const,
        game,
        periodId,
        total: sortedDistribution.reduce(
            (sum, item) => sum + item.betCount,
            0
        ),
        totalBetAmount: sortedDistribution.reduce(
            (sum, item) => sum + item.amount,
            0
        ),
        distribution: sortedDistribution,
        bets,
    };
}

export const dashboardInsightsRoutes = (app: OpenAPIHono) => {
    app.openapi(getDashboardEarningsRoute, async (c) => {
        try {
            c.header("Cache-Control", "private, no-store");
            const cached = await Cache.get<z.infer<typeof dashboardEarningsSchema>>(
                CacheKey.adminDashboardEarnings
            );
            if (cached) {
                return c.json(
                    { success: true, earnings: cached },
                    HTTP_STATUS.OK
                );
            }

            const todayYmd = ymdIst();
            const startOfToday = parseYmdStartIst(todayYmd);
            const startOfTomorrow = parseYmdStartIst(
                shiftYmdIst(todayYmd, 1)
            );
            const todayCreatedAt = {
                gte: startOfToday,
                lt: startOfTomorrow,
            };

            const [
                allRebates,
                todayRebates,
                allSalaryPayments,
                todaySalaryPayments,
                allAutoSalary,
                todayAutoSalary,
            ] = await Promise.all([
                prisma.rebate.aggregate({
                    where: { settled: true, user: REAL_USER_WHERE },
                    _sum: { amount: true },
                }),
                prisma.rebate.aggregate({
                    where: {
                        // Today's commission accrues during the day and is
                        // only settled after the day closes.
                        settled: false,
                        createdAt: todayCreatedAt,
                        user: REAL_USER_WHERE,
                    },
                    _sum: { amount: true },
                }),
                prisma.salaryPayment.aggregate({
                    where: { user: REAL_USER_WHERE },
                    _sum: { amount: true },
                }),
                prisma.salaryPayment.aggregate({
                    where: {
                        createdAt: todayCreatedAt,
                        user: REAL_USER_WHERE,
                    },
                    _sum: { amount: true },
                }),
                prisma.autoSalaryClaim.aggregate({
                    where: { status: "APPROVED", user: REAL_USER_WHERE },
                    _sum: { amount: true },
                }),
                prisma.autoSalaryClaim.aggregate({
                    where: {
                        status: "APPROVED",
                        reviewedAt: todayCreatedAt,
                        user: REAL_USER_WHERE,
                    },
                    _sum: { amount: true },
                }),
            ]);

            const earnings = {
                allTimeRebateCommission: allRebates._sum.amount ?? 0,
                todayRebateCommission: todayRebates._sum.amount ?? 0,
                allTimeSalary:
                    (allSalaryPayments._sum.amount ?? 0) +
                    (allAutoSalary._sum.amount ?? 0),
                todaySalary:
                    (todaySalaryPayments._sum.amount ?? 0) +
                    (todayAutoSalary._sum.amount ?? 0),
                updatedAt: new Date().toISOString(),
            };

            // Tiny shared cache protects the DB when several admins have the
            // dashboard open. Payment paths invalidate it immediately.
            await Cache.set(CacheKey.adminDashboardEarnings, earnings, 2);

            return c.json(
                { success: true, earnings },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Failed to load dashboard earnings", error);
            return apiError(
                c,
                "Failed to load dashboard earnings",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.openapi(getLiveWingoRoute, async (c) => {
        try {
            c.header("Cache-Control", "private, no-store");
            const now = new Date();
            const periods = await prisma.wingoPeriod.findMany({
                where: {
                    durationSeconds: { in: [30, 60] },
                    status: "ACTIVE",
                    startTime: { lte: now },
                    endTime: { gt: now },
                },
                orderBy: [{ durationSeconds: "asc" }, { startTime: "desc" }],
                distinct: ["durationSeconds"],
                select: {
                    id: true,
                    periodNumber: true,
                    durationSeconds: true,
                    startTime: true,
                    endTime: true,
                },
            });

            const snapshots = await Promise.all(
                periods.map(async (period) => {
                    const groups = await prisma.wingoBet.groupBy({
                        by: ["betType", "betChoice"],
                        where: {
                            periodId: period.id,
                            status: "PENDING",
                            user: REAL_USER_WHERE,
                        },
                        _count: { _all: true },
                        _sum: { betAmount: true },
                    });

                    const selections = groups
                        .map((group) => ({
                            betType: group.betType,
                            betChoice: group.betChoice,
                            betCount: group._count._all,
                            amount: group._sum.betAmount ?? 0,
                        }))
                        .sort(
                            (a, b) =>
                                b.amount - a.amount ||
                                a.betType.localeCompare(b.betType) ||
                                a.betChoice.localeCompare(b.betChoice)
                        );

                    return {
                        ...period,
                        startTime: period.startTime.toISOString(),
                        endTime: period.endTime.toISOString(),
                        betCount: selections.reduce(
                            (total, item) => total + item.betCount,
                            0
                        ),
                        totalBetAmount: selections.reduce(
                            (total, item) => total + item.amount,
                            0
                        ),
                        selections,
                    };
                })
            );

            return c.json(
                { success: true, periods: snapshots },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Failed to load live WinGo dashboard cards", error);
            return apiError(
                c,
                "Failed to load live WinGo data",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.openapi(getRecentWingoBetsRoute, async (c) => {
        try {
            c.header("Cache-Control", "private, no-store");
            const results = await prisma.wingoBetResult.findMany({
                where: { bet: { user: REAL_USER_WHERE } },
                take: 50,
                orderBy: { processedAt: "desc" },
                select: {
                    isWin: true,
                    winAmount: true,
                    processedAt: true,
                    period: {
                        select: {
                            periodNumber: true,
                            durationSeconds: true,
                            resultNumber: true,
                            resultColor: true,
                            resultSize: true,
                        },
                    },
                    bet: {
                        select: {
                            id: true,
                            betType: true,
                            betChoice: true,
                            betAmount: true,
                            createdAt: true,
                            user: { select: ADMIN_USER_IDENTITY_SELECT },
                        },
                    },
                },
            });

            return c.json(
                {
                    success: true,
                    bets: results.map((result) => ({
                        id: result.bet.id,
                        user: mapAdminUserIdentity(result.bet.user),
                        periodNumber: result.period.periodNumber,
                        durationSeconds: result.period.durationSeconds,
                        betType: result.bet.betType,
                        betChoice: result.bet.betChoice,
                        betAmount: result.bet.betAmount,
                        resultNumber: result.period.resultNumber,
                        resultColor: result.period.resultColor,
                        resultSize: result.period.resultSize,
                        status: result.isWin ? ("WON" as const) : ("LOST" as const),
                        winAmount: result.winAmount,
                        placedAt: result.bet.createdAt.toISOString(),
                        settledAt: result.processedAt.toISOString(),
                    })),
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Failed to load recent settled WinGo bets", error);
            return apiError(
                c,
                "Failed to load settled WinGo bets",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.openapi(getTopUsersRoute, async (c) => {
        try {
            c.header("Cache-Control", "private, no-store");
            const { sort } = c.req.valid("query");

            if (sort === "withdrawals") {
                const withdrawalGroups = await prisma.withdraw.groupBy({
                    by: ["userId"],
                    where: { status: "SUCCESS", user: REAL_USER_WHERE },
                    _count: { _all: true },
                    _sum: { amount: true },
                    orderBy: { _sum: { amount: "desc" } },
                    take: 100,
                });
                const users = await prisma.user.findMany({
                    where: {
                        ...REAL_USER_WHERE,
                        id: { in: withdrawalGroups.map((row) => row.userId) },
                    },
                    select: {
                        ...ADMIN_USER_IDENTITY_SELECT,
                        balance: true,
                        isBanned: true,
                    },
                });
                const userById = new Map(users.map((user) => [user.id, user]));
                const rankedUsers = withdrawalGroups.flatMap((group, index) => {
                    const user = userById.get(group.userId);
                    return user
                        ? [
                              {
                                  rank: index + 1,
                                  user: mapAdminUserIdentity(user),
                                  balance: user.balance,
                                  successfulWithdrawAmount: group._sum.amount ?? 0,
                                  successfulWithdrawCount: group._count._all,
                                  isBanned: user.isBanned,
                              },
                          ]
                        : [];
                });

                return c.json(
                    { success: true, sort, users: rankedUsers },
                    HTTP_STATUS.OK
                );
            }

            const users = await prisma.user.findMany({
                where: REAL_USER_WHERE,
                take: 100,
                orderBy: [{ balance: "desc" }, { serialNumber: "asc" }],
                select: {
                    ...ADMIN_USER_IDENTITY_SELECT,
                    balance: true,
                    isBanned: true,
                },
            });
            const userIds = users.map((user) => user.id);
            const withdrawalGroups = userIds.length
                ? await prisma.withdraw.groupBy({
                      by: ["userId"],
                      where: {
                          userId: { in: userIds },
                          status: "SUCCESS",
                      },
                      _count: { _all: true },
                      _sum: { amount: true },
                  })
                : [];
            const withdrawByUser = new Map(
                withdrawalGroups.map((group) => [group.userId, group])
            );

            return c.json(
                {
                    success: true,
                    sort,
                    users: users.map((user, index) => {
                        const withdrawals = withdrawByUser.get(user.id);
                        return {
                            rank: index + 1,
                            user: mapAdminUserIdentity(user),
                            balance: user.balance,
                            successfulWithdrawAmount:
                                withdrawals?._sum.amount ?? 0,
                            successfulWithdrawCount:
                                withdrawals?._count._all ?? 0,
                            isBanned: user.isBanned,
                        };
                    }),
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Failed to load top users", error);
            return apiError(
                c,
                "Failed to load top users",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.openapi(getGameLiveBetsRoute, async (c) => {
        try {
            c.header("Cache-Control", "private, no-store");
            const { game, periodId } = c.req.valid("query");
            const where = {
                periodId,
                status: "PENDING" as const,
                user: REAL_USER_WHERE,
            };

            if (game === "wingo") {
                const [groups, rows] = await Promise.all([
                    prisma.wingoBet.groupBy({
                        by: ["betType", "betChoice"],
                        where,
                        _count: { _all: true },
                        _sum: { betAmount: true },
                    }),
                    prisma.wingoBet.findMany({
                        where,
                        take: 100,
                        orderBy: { createdAt: "desc" },
                        select: {
                            id: true,
                            betType: true,
                            betChoice: true,
                            betAmount: true,
                            status: true,
                            createdAt: true,
                            user: { select: ADMIN_USER_IDENTITY_SELECT },
                        },
                    }),
                ]);
                return c.json(
                    liveBookPayload(
                        game,
                        periodId,
                        groups.map((row) => ({
                            betType: row.betType,
                            betChoice: row.betChoice,
                            betCount: row._count._all,
                            amount: row._sum.betAmount ?? 0,
                        })),
                        rows.map((row) => ({
                            ...row,
                            user: mapAdminUserIdentity(row.user),
                            status: "PENDING" as const,
                            createdAt: row.createdAt.toISOString(),
                        }))
                    ),
                    HTTP_STATUS.OK
                );
            }

            if (game === "trxwingo") {
                const [groups, rows] = await Promise.all([
                    prisma.trxWingoBet.groupBy({
                        by: ["betType", "betChoice"],
                        where,
                        _count: { _all: true },
                        _sum: { betAmount: true },
                    }),
                    prisma.trxWingoBet.findMany({
                        where,
                        take: 100,
                        orderBy: { createdAt: "desc" },
                        select: {
                            id: true,
                            betType: true,
                            betChoice: true,
                            betAmount: true,
                            status: true,
                            createdAt: true,
                            user: { select: ADMIN_USER_IDENTITY_SELECT },
                        },
                    }),
                ]);
                return c.json(
                    liveBookPayload(
                        game,
                        periodId,
                        groups.map((row) => ({
                            betType: row.betType,
                            betChoice: row.betChoice,
                            betCount: row._count._all,
                            amount: row._sum.betAmount ?? 0,
                        })),
                        rows.map((row) => ({
                            ...row,
                            user: mapAdminUserIdentity(row.user),
                            status: "PENDING" as const,
                            createdAt: row.createdAt.toISOString(),
                        }))
                    ),
                    HTTP_STATUS.OK
                );
            }

            if (game === "k3") {
                const [groups, rows] = await Promise.all([
                    prisma.k3Bet.groupBy({
                        by: ["betType", "betChoice"],
                        where,
                        _count: { _all: true },
                        _sum: { betAmount: true },
                    }),
                    prisma.k3Bet.findMany({
                        where,
                        take: 100,
                        orderBy: { createdAt: "desc" },
                        select: {
                            id: true,
                            betType: true,
                            betChoice: true,
                            betAmount: true,
                            status: true,
                            createdAt: true,
                            user: { select: ADMIN_USER_IDENTITY_SELECT },
                        },
                    }),
                ]);
                return c.json(
                    liveBookPayload(
                        game,
                        periodId,
                        groups.map((row) => ({
                            betType: row.betType,
                            betChoice: row.betChoice,
                            betCount: row._count._all,
                            amount: row._sum.betAmount ?? 0,
                        })),
                        rows.map((row) => ({
                            ...row,
                            user: mapAdminUserIdentity(row.user),
                            status: "PENDING" as const,
                            createdAt: row.createdAt.toISOString(),
                        }))
                    ),
                    HTTP_STATUS.OK
                );
            }

            if (game === "5d") {
                const [groups, rows] = await Promise.all([
                    prisma.fiveDBet.groupBy({
                        by: ["betCategory", "position", "betType", "betChoice"],
                        where,
                        _count: { _all: true },
                        _sum: { betAmount: true },
                    }),
                    prisma.fiveDBet.findMany({
                        where,
                        take: 100,
                        orderBy: { createdAt: "desc" },
                        select: {
                            id: true,
                            betCategory: true,
                            position: true,
                            betType: true,
                            betChoice: true,
                            betAmount: true,
                            status: true,
                            createdAt: true,
                            user: { select: ADMIN_USER_IDENTITY_SELECT },
                        },
                    }),
                ]);
                const typeLabel = (row: {
                    betCategory: string;
                    position: string | null;
                    betType: string;
                }) =>
                    [row.betCategory, row.position, row.betType]
                        .filter(Boolean)
                        .join(" / ");
                return c.json(
                    liveBookPayload(
                        game,
                        periodId,
                        groups.map((row) => ({
                            betType: typeLabel(row),
                            betChoice: row.betChoice,
                            betCount: row._count._all,
                            amount: row._sum.betAmount ?? 0,
                        })),
                        rows.map((row) => ({
                            id: row.id,
                            user: mapAdminUserIdentity(row.user),
                            betType: typeLabel(row),
                            betChoice: row.betChoice,
                            betAmount: row.betAmount,
                            status: "PENDING" as const,
                            createdAt: row.createdAt.toISOString(),
                        }))
                    ),
                    HTTP_STATUS.OK
                );
            }

            const [groups, rows] = await Promise.all([
                prisma.motoBet.groupBy({
                    by: ["targetPosition", "betType", "betChoice"],
                    where,
                    _count: { _all: true },
                    _sum: { betAmount: true },
                }),
                prisma.motoBet.findMany({
                    where,
                    take: 100,
                    orderBy: { createdAt: "desc" },
                    select: {
                        id: true,
                        targetPosition: true,
                        betType: true,
                        betChoice: true,
                        betAmount: true,
                        status: true,
                        createdAt: true,
                        user: { select: ADMIN_USER_IDENTITY_SELECT },
                    },
                }),
            ]);
            const typeLabel = (row: {
                targetPosition: string;
                betType: string;
            }) => `${row.targetPosition} / ${row.betType}`;
            return c.json(
                liveBookPayload(
                    game,
                    periodId,
                    groups.map((row) => ({
                        betType: typeLabel(row),
                        betChoice: row.betChoice,
                        betCount: row._count._all,
                        amount: row._sum.betAmount ?? 0,
                    })),
                    rows.map((row) => ({
                        id: row.id,
                        user: mapAdminUserIdentity(row.user),
                        betType: typeLabel(row),
                        betChoice: row.betChoice,
                        betAmount: row.betAmount,
                        status: "PENDING" as const,
                        createdAt: row.createdAt.toISOString(),
                    }))
                ),
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Failed to load admin game live bets", error);
            return apiError(
                c,
                "Failed to load live bets",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
