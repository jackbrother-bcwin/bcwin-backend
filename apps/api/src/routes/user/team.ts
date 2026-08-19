import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import {
    teamQuerySchema,
    teamMemberSchema,
    teamOverviewSchema,
} from "@/schemas/commission";
import { Cache, CacheKey } from "@bcwin/cache";
import {
    isValidYmd,
    parseYmdEndExclusiveIst,
    parseYmdStartIst,
} from "@/lib/istDate";

const logger = new Logger("commission-team");

type DateRange = { gte: Date; lt: Date } | undefined;

async function sumUserBetting(
    userId: string | { in: string[] },
    range?: DateRange
): Promise<number> {
    const whereBase =
        typeof userId === "string"
            ? { userId }
            : { userId: { in: userId.in } };
    const createdAt = range ? { createdAt: range } : {};

    const [
        wingoBets,
        fiveDBets,
        k3Bets,
        motoBets,
        trxWingoBets,
        inoutBets,
    ] = await Promise.all([
        prisma.wingoBet.aggregate({
            where: { ...whereBase, ...createdAt },
            _sum: { betAmount: true },
        }),
        prisma.fiveDBet.aggregate({
            where: { ...whereBase, ...createdAt },
            _sum: { betAmount: true },
        }),
        prisma.k3Bet.aggregate({
            where: { ...whereBase, ...createdAt },
            _sum: { betAmount: true },
        }),
        prisma.motoBet.aggregate({
            where: { ...whereBase, ...createdAt },
            _sum: { betAmount: true },
        }),
        prisma.trxWingoBet.aggregate({
            where: { ...whereBase, ...createdAt },
            _sum: { betAmount: true },
        }),
        prisma.inoutBet.aggregate({
            where: {
                ...whereBase,
                ...createdAt,
                isRolledback: false,
            },
            _sum: { betAmount: true },
        }),
    ]);

    return (
        (wingoBets._sum.betAmount || 0) +
        (fiveDBets._sum.betAmount || 0) +
        (k3Bets._sum.betAmount || 0) +
        (motoBets._sum.betAmount || 0) +
        (trxWingoBets._sum.betAmount || 0) +
        (inoutBets._sum.betAmount || 0)
    );
}

async function countUserBets(
    userId: string,
    range?: DateRange
): Promise<number> {
    const createdAt = range ? { createdAt: range } : {};
    const [wingo, fiveD, k3, moto, trx, inout] = await Promise.all([
        prisma.wingoBet.count({ where: { userId, ...createdAt } }),
        prisma.fiveDBet.count({ where: { userId, ...createdAt } }),
        prisma.k3Bet.count({ where: { userId, ...createdAt } }),
        prisma.motoBet.count({ where: { userId, ...createdAt } }),
        prisma.trxWingoBet.count({ where: { userId, ...createdAt } }),
        prisma.inoutBet.count({
            where: { userId, isRolledback: false, ...createdAt },
        }),
    ]);
    return wingo + fiveD + k3 + moto + trx + inout;
}

const teamMembersResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    data: z.array(teamMemberSchema).openapi({
        description: "Array of team members",
    }),
    total: z.number().openapi({
        description: "Total number of team members",
        example: 45,
    }),
    currentPage: z.number().openapi({
        description: "Current page number",
        example: 1,
    }),
    totalPages: z.number().openapi({
        description: "Total number of pages",
        example: 2,
    }),
    /** Aggregates over ALL filtered members (not just current page) */
    summary: z
        .object({
            memberCount: z.number(),
            depositCount: z.number().optional(),
            totalBetting: z.number(),
            totalDeposit: z.number(),
            depositors: z.number(),
            bettors: z.number(),
            firstDepositUsers: z.number().optional(),
            firstDepositAmount: z.number().optional(),
        })
        .optional(),
});

/** Members who bet, deposited, or generated settled rebate in `range`. */
async function memberIdsActiveOnDay(
    memberIds: string[],
    agentId: string,
    range: NonNullable<DateRange>
): Promise<Set<string>> {
    if (memberIds.length === 0) return new Set();
    const createdAt = { createdAt: range };
    const [
        wingo,
        fiveD,
        k3,
        moto,
        trx,
        inout,
        deposits,
        rebates,
    ] = await Promise.all([
        prisma.wingoBet.findMany({
            where: { userId: { in: memberIds }, ...createdAt },
            select: { userId: true },
            distinct: ["userId"],
        }),
        prisma.fiveDBet.findMany({
            where: { userId: { in: memberIds }, ...createdAt },
            select: { userId: true },
            distinct: ["userId"],
        }),
        prisma.k3Bet.findMany({
            where: { userId: { in: memberIds }, ...createdAt },
            select: { userId: true },
            distinct: ["userId"],
        }),
        prisma.motoBet.findMany({
            where: { userId: { in: memberIds }, ...createdAt },
            select: { userId: true },
            distinct: ["userId"],
        }),
        prisma.trxWingoBet.findMany({
            where: { userId: { in: memberIds }, ...createdAt },
            select: { userId: true },
            distinct: ["userId"],
        }),
        prisma.inoutBet.findMany({
            where: {
                userId: { in: memberIds },
                isRolledback: false,
                ...createdAt,
            },
            select: { userId: true },
            distinct: ["userId"],
        }),
        prisma.deposit.findMany({
            where: {
                userId: { in: memberIds },
                status: "SUCCESS",
                ...createdAt,
            },
            select: { userId: true },
            distinct: ["userId"],
        }),
        prisma.rebate.findMany({
            where: {
                userId: agentId,
                fromUserId: { in: memberIds },
                settled: true,
                ...createdAt,
            },
            select: { fromUserId: true },
            distinct: ["fromUserId"],
        }),
    ]);
    const ids = new Set<string>();
    for (const row of [
        ...wingo,
        ...fiveD,
        ...k3,
        ...moto,
        ...trx,
        ...inout,
        ...deposits,
    ]) {
        ids.add(row.userId);
    }
    for (const row of rebates) {
        if (row.fromUserId) ids.add(row.fromUserId);
    }
    return ids;
}

async function countBettors(
    userIds: string[],
    range?: DateRange
): Promise<number> {
    if (userIds.length === 0) return 0;
    const createdAt = range ? { createdAt: range } : {};
    const [w, f, k, m, t, i] = await Promise.all([
        prisma.wingoBet.findMany({
            where: { userId: { in: userIds }, ...createdAt },
            select: { userId: true },
            distinct: ["userId"],
        }),
        prisma.fiveDBet.findMany({
            where: { userId: { in: userIds }, ...createdAt },
            select: { userId: true },
            distinct: ["userId"],
        }),
        prisma.k3Bet.findMany({
            where: { userId: { in: userIds }, ...createdAt },
            select: { userId: true },
            distinct: ["userId"],
        }),
        prisma.motoBet.findMany({
            where: { userId: { in: userIds }, ...createdAt },
            select: { userId: true },
            distinct: ["userId"],
        }),
        prisma.trxWingoBet.findMany({
            where: { userId: { in: userIds }, ...createdAt },
            select: { userId: true },
            distinct: ["userId"],
        }),
        prisma.inoutBet.findMany({
            where: {
                userId: { in: userIds },
                isRolledback: false,
                ...createdAt,
            },
            select: { userId: true },
            distinct: ["userId"],
        }),
    ]);
    return new Set(
        [...w, ...f, ...k, ...m, ...t, ...i].map((r) => r.userId)
    ).size;
}

const teamOverviewResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    data: teamOverviewSchema.openapi({
        description: "Team overview statistics",
    }),
});

const getTeamMembersRoute = createRoute({
    method: "get",
    tags: ["user"],
    path: "/team/members",
    summary: "Get team members",
    description: "Retrieve list of team members with their statistics",
    request: {
        cookies: authCookie,
        query: teamQuerySchema,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: teamMembersResponseSchema,
                },
            },
            description: "Successfully retrieved team members",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

const getTeamOverviewRoute = createRoute({
    method: "get",
    tags: ["user"],
    path: "/team/overview",
    summary: "Get team overview",
    description:
        "Lifetime team stats when `date` is omitted (also upserts TeamMetrics). " +
        "With `date` (IST YYYY-MM-DD): register / SUCCESS deposits / first SUCCESS for that day only — no TeamMetrics write.",
    request: {
        cookies: authCookie,
        query: z.object({
            date: z
                .string()
                .optional()
                .openapi({
                    description:
                        "Optional IST day YYYY-MM-DD. Omit for all-time (VIP/salary).",
                    example: "2026-08-18",
                }),
        }),
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: teamOverviewResponseSchema,
                },
            },
            description: "Successfully retrieved team overview",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

// Helper function to get team members recursively (excludes demo accounts)
async function getTeamMembers(
    userId: string,
    maxLayers: number = 6
): Promise<Array<{ user: any; layer: number }>> {
    const teamMembers: Array<{ user: any; layer: number }> = [];
    let currentLayerUsers = [userId];

    for (let layer = 1; layer <= maxLayers; layer++) {
        if (currentLayerUsers.length === 0) break;

        const codes = await prisma.user
            .findMany({
                where: { id: { in: currentLayerUsers } },
                select: { referralCode: true },
            })
            .then((users) => users.map((u) => u.referralCode));

        if (codes.length === 0) break;

        // Get users who were referred by current layer users (skip demos)
        const nextLayerUsers = await prisma.user.findMany({
            where: {
                referredBy: { in: codes },
                isDemo: false,
            },
            select: {
                id: true,
                username: true,
                mobileNumber: true,
                email: true,
                serialNumber: true,
                createdAt: true,
                referralCode: true,
            },
        });

        for (const user of nextLayerUsers) {
            teamMembers.push({ user, layer });
        }

        currentLayerUsers = nextLayerUsers.map((u) => u.id);
    }

    return teamMembers;
}

export const teamRoutes = (app: OpenAPIHono) => {
    app.openapi(getTeamMembersRoute, async (c) => {
        try {
            const user = c.get("user");
            const {
                layer,
                username,
                date,
                page = 1,
                limit = 30,
            } = c.req.valid("query");

            const pageNum = page;
            const limitNum = Math.min(limit, 100);
            const skip = (pageNum - 1) * limitNum;

            let dayRange: DateRange;
            if (date) {
                if (!isValidYmd(date)) {
                    return apiError(
                        c,
                        "Invalid date format. Use YYYY-MM-DD",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }
                dayRange = {
                    gte: parseYmdStartIst(date),
                    lt: parseYmdEndExclusiveIst(date),
                };
            }

            // Short cache (20s). v6 = 6-stat overview box support
            const mainCacheKey = CacheKey.teamMembers(user.id);
            const fieldKey = `v9-layer:${layer || "all"}-username:${
                username || "all"
            }-date:${date || "all"}-page:${page}-limit:${limitNum}`;

            const cachedData = await Cache.hget<{
                data: Array<{
                    id: string;
                    username: string;
                    mobileNumber?: string;
                    email?: string;
                    serialNumber?: number;
                    layer: number;
                    totalBetting: number;
                    betCount?: number;
                    totalDeposit: number;
                    commissionGenerated: number;
                    createdAt: string;
                }>;
                total: number;
                currentPage: number;
                totalPages: number;
                summary?: {
                    memberCount: number;
                    depositCount?: number;
                    totalBetting: number;
                    totalDeposit: number;
                    depositors: number;
                    bettors: number;
                    firstDepositUsers?: number;
                    firstDepositAmount?: number;
                };
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

            // Get all team members
            const teamMembers = await getTeamMembers(user.id);

            // Filter by layer if specified
            let filteredMembers = teamMembers;
            if (layer && layer !== "all") {
                const layerNum = parseInt(layer, 10);
                if (layerNum >= 1 && layerNum <= 6) {
                    filteredMembers = teamMembers.filter(
                        (m) => m.layer === layerNum
                    );
                } else {
                    return apiError(
                        c,
                        "Layer must be between 1 and 6",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }
            }

            // Filter by username, mobileNumber, email or UID/serialNumber if specified
            if (username) {
                const query = username.toLowerCase();
                filteredMembers = filteredMembers.filter(
                    (m) =>
                        m.user.username.toLowerCase().includes(query) ||
                        (m.user.mobileNumber && m.user.mobileNumber.toLowerCase().includes(query)) ||
                        (m.user.email && m.user.email.toLowerCase().includes(query)) ||
                        (m.user.serialNumber &&
                            String(m.user.serialNumber).includes(query))
                );
            }

            // Date filter: only people who actually played/deposited/paid
            // rebate on that IST day — not the live roster (today's joins).
            if (dayRange) {
                const active = await memberIdsActiveOnDay(
                    filteredMembers.map((m) => m.user.id),
                    user.id,
                    dayRange
                );
                filteredMembers = filteredMembers.filter((m) =>
                    active.has(m.user.id)
                );
            }

            // Paginate
            const paginatedMembers = filteredMembers.slice(
                skip,
                skip + limitNum
            );
            const total = filteredMembers.length;
            const totalPages = Math.max(1, Math.ceil(total / limitNum) || 1);

            // Get statistics for each member (lifetime or single IST day)
            const membersWithStats = await Promise.all(
                paginatedMembers.map(async ({ user: member, layer: L }) => {
                    const depositWhere: {
                        userId: string;
                        status: "SUCCESS";
                        createdAt?: DateRange;
                    } = {
                        userId: member.id,
                        status: "SUCCESS",
                    };
                    if (dayRange) depositWhere.createdAt = dayRange;

                    // Same as TX: only settled team rebate (after 01:30 IST)
                    const rebateWhere: {
                        userId: string;
                        fromUserId: string;
                        settled: true;
                        createdAt?: DateRange;
                    } = {
                        userId: user.id,
                        fromUserId: member.id,
                        settled: true,
                    };
                    if (dayRange) rebateWhere.createdAt = dayRange;

                    const [totalBetting, betCount, deposits, rebatesFromMember] =
                        await Promise.all([
                            sumUserBetting(member.id, dayRange),
                            countUserBets(member.id, dayRange),
                            prisma.deposit.aggregate({
                                where: depositWhere,
                                _sum: { amount: true },
                            }),
                            prisma.rebate.aggregate({
                                where: rebateWhere,
                                _sum: { amount: true },
                            }),
                        ]);

                    return {
                        id: member.id,
                        username: member.username,
                        mobileNumber: member.mobileNumber ?? undefined,
                        email: member.email ?? undefined,
                        serialNumber: member.serialNumber,
                        layer: L,
                        totalBetting,
                        betCount,
                        totalDeposit: deposits._sum.amount || 0,
                        commissionGenerated:
                            rebatesFromMember._sum.amount || 0,
                        createdAt: member.createdAt.toISOString(),
                    };
                })
            );

            // Full-filter summary (not page-only) so FE stats match DB
            const filteredIds = filteredMembers.map((m) => m.user.id);
            const depositWhereBase: {
                userId: { in: string[] };
                status: "SUCCESS";
                createdAt?: DateRange;
            } = {
                userId: { in: filteredIds },
                status: "SUCCESS",
            };
            if (dayRange) depositWhereBase.createdAt = dayRange;

            const [summaryBetting, summaryDep, depositors, bettors] =
                await Promise.all([
                    filteredIds.length
                        ? sumUserBetting({ in: filteredIds }, dayRange)
                        : Promise.resolve(0),
                    filteredIds.length
                        ? prisma.deposit.aggregate({
                              where: depositWhereBase,
                              _sum: { amount: true },
                              _count: true,
                          })
                        : Promise.resolve({
                              _sum: { amount: 0 as number | null },
                              _count: 0,
                          }),
                    filteredIds.length
                        ? prisma.deposit.findMany({
                              where: depositWhereBase,
                              select: { userId: true },
                              distinct: ["userId"],
                          })
                        : Promise.resolve([] as { userId: string }[]),
                    countBettors(filteredIds, dayRange),
                ]);

            let firstDepositUsers = 0;
            let firstDepositAmount = 0;

            if (filteredIds.length > 0) {
                const firstDeposits = await prisma.deposit.findMany({
                    where: {
                        userId: { in: filteredIds },
                        status: "SUCCESS",
                    },
                    orderBy: { createdAt: "asc" },
                    distinct: ["userId"],
                    select: {
                        userId: true,
                        amount: true,
                        createdAt: true,
                    },
                });

                for (const fd of firstDeposits) {
                    if (dayRange) {
                        const t = fd.createdAt.getTime();
                        if (t >= dayRange.gte.getTime() && t < dayRange.lt.getTime()) {
                            firstDepositUsers++;
                            firstDepositAmount += fd.amount;
                        }
                    } else {
                        firstDepositUsers++;
                        firstDepositAmount += fd.amount;
                    }
                }
            }

            const result = {
                data: membersWithStats,
                total,
                currentPage: pageNum,
                totalPages,
                summary: {
                    memberCount: total,
                    depositCount: summaryDep._count || 0,
                    totalBetting: summaryBetting,
                    totalDeposit: summaryDep._sum.amount || 0,
                    depositors: depositors.length,
                    bettors,
                    firstDepositUsers,
                    firstDepositAmount,
                },
            };

            await Cache.hset(mainCacheKey, fieldKey, result, 20);

            return c.json(
                {
                    success: true,
                    ...result,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error fetching team members:", error);
            return apiError(
                c,
                "Failed to fetch team members",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.openapi(getTeamOverviewRoute, async (c) => {
        try {
            const user = c.get("user");
            const { date } = c.req.valid("query");

            let range: DateRange;
            if (date) {
                if (!isValidYmd(date)) {
                    return apiError(
                        c,
                        "Invalid date format. Use YYYY-MM-DD",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }
                range = {
                    gte: parseYmdStartIst(date),
                    lt: parseYmdEndExclusiveIst(date),
                };
            }

            const cacheKey = range
                ? `${CacheKey.teamOverview(user.id)}:${date}`
                : CacheKey.teamOverview(user.id);

            type OverviewPayload = {
                directTeamSize: number;
                totalTeamSize: number;
                totalTeamBetting: number;
                totalTeamDeposit: number;
                totalCommissionEarned: number;
                directTeamBetting: number;
                directTeamDeposit: number;
                directDepositCount: number;
                teamDepositCount: number;
                directFirstDepositUsers: number;
                teamFirstDepositUsers: number;
            };

            const cachedOverview = await Cache.get<OverviewPayload>(cacheKey);
            if (cachedOverview) {
                return c.json(
                    {
                        success: true,
                        data: cachedOverview,
                    },
                    HTTP_STATUS.OK
                );
            }

            const teamMembers = await getTeamMembers(user.id);
            const directMembers = teamMembers.filter((m) => m.layer === 1);

            const inRange = (d: Date) =>
                !range || (d >= range.gte && d < range.lt);

            const registered = range
                ? teamMembers.filter((m) => inRange(m.user.createdAt))
                : teamMembers;
            const registeredDirect = registered.filter((m) => m.layer === 1);

            const directTeamSize = registeredDirect.length;
            const totalTeamSize = registered.length;

            const memberIds = teamMembers.map((m) => m.user.id);
            const directIds = directMembers.map((m) => m.user.id);
            const createdAt = range ? { createdAt: range } : {};

            const emptyDepAgg = {
                _sum: { amount: 0 as number | null },
                _count: 0,
            };

            const [
                totalTeamBetting,
                directTeamBetting,
                deposits,
                directDeposits,
                commissionTotal,
                firstsAll,
                firstsDirect,
            ] = await Promise.all([
                memberIds.length
                    ? sumUserBetting({ in: memberIds }, range)
                    : Promise.resolve(0),
                directIds.length
                    ? sumUserBetting({ in: directIds }, range)
                    : Promise.resolve(0),
                memberIds.length
                    ? prisma.deposit.aggregate({
                          where: {
                              userId: { in: memberIds },
                              status: "SUCCESS",
                              ...createdAt,
                          },
                          _sum: { amount: true },
                          _count: true,
                      })
                    : Promise.resolve(emptyDepAgg),
                directIds.length
                    ? prisma.deposit.aggregate({
                          where: {
                              userId: { in: directIds },
                              status: "SUCCESS",
                              ...createdAt,
                          },
                          _sum: { amount: true },
                          _count: true,
                      })
                    : Promise.resolve(emptyDepAgg),
                prisma.rebate.aggregate({
                    where: {
                        userId: user.id,
                        settled: true,
                        ...createdAt,
                    },
                    _sum: { amount: true },
                }),
                memberIds.length
                    ? prisma.deposit.groupBy({
                          by: ["userId"],
                          where: {
                              userId: { in: memberIds },
                              status: "SUCCESS",
                          },
                          _min: { createdAt: true },
                      })
                    : Promise.resolve(
                          [] as Array<{
                              userId: string;
                              _min: { createdAt: Date | null };
                          }>
                      ),
                directIds.length
                    ? prisma.deposit.groupBy({
                          by: ["userId"],
                          where: {
                              userId: { in: directIds },
                              status: "SUCCESS",
                          },
                          _min: { createdAt: true },
                      })
                    : Promise.resolve(
                          [] as Array<{
                              userId: string;
                              _min: { createdAt: Date | null };
                          }>
                      ),
            ]);

            const firstInWindow = (
                rows: Array<{ _min: { createdAt: Date | null } }>
            ) =>
                rows.filter((r) => {
                    const t = r._min.createdAt;
                    return t != null && inRange(t);
                }).length;

            const finalData: OverviewPayload = {
                directTeamSize,
                totalTeamSize,
                totalTeamBetting,
                totalTeamDeposit: deposits._sum.amount || 0,
                totalCommissionEarned: commissionTotal._sum.amount || 0,
                directTeamBetting,
                directTeamDeposit: directDeposits._sum.amount || 0,
                directDepositCount: directDeposits._count || 0,
                teamDepositCount: deposits._count || 0,
                directFirstDepositUsers: firstInWindow(firstsDirect),
                teamFirstDepositUsers: firstInWindow(firstsAll),
            };

            if (!range) {
                void prisma.teamMetrics
                    .upsert({
                        where: { userId: user.id },
                        update: {
                            directTeamSize,
                            directTeamBetting,
                            directTeamDeposit: finalData.directTeamDeposit,
                            totalTeamSize,
                            totalTeamBetting,
                            totalTeamDeposit: finalData.totalTeamDeposit,
                            lastUpdated: new Date(),
                        },
                        create: {
                            userId: user.id,
                            directTeamSize,
                            directTeamBetting,
                            directTeamDeposit: finalData.directTeamDeposit,
                            totalTeamSize,
                            totalTeamBetting,
                            totalTeamDeposit: finalData.totalTeamDeposit,
                            lastUpdated: new Date(),
                        },
                    })
                    .catch((e) =>
                        logger.warn("Failed to upsert team metrics", e)
                    );
            }

            await Cache.set(cacheKey, finalData, 30);

            return c.json(
                {
                    success: true,
                    data: finalData,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error fetching team overview:", error);
            return apiError(
                c,
                "Failed to fetch team overview",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
