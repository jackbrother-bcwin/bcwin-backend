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
    shiftYmdIst,
    ymdIst,
} from "@/lib/istDate";
import { sumRebateAmount } from "@/lib/rebateDayTotals";

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

type UserBetStat = { amount: number; count: number };
type UserMoneyStat = { amount: number; count: number };

const ID_CHUNK = 2000;

function addBetStat(
    map: Map<string, UserBetStat>,
    userId: string,
    amount: number,
    count: number
) {
    const prev = map.get(userId) ?? { amount: 0, count: 0 };
    prev.amount += amount;
    prev.count += count;
    map.set(userId, prev);
}

/** One GROUP BY per game table — not 6+6 queries per card. */
async function betStatsByUser(
    userIds: string[],
    range?: DateRange
): Promise<Map<string, UserBetStat>> {
    const map = new Map<string, UserBetStat>();
    if (userIds.length === 0) return map;
    const createdAt = range ? { createdAt: range } : {};
    for (let i = 0; i < userIds.length; i += ID_CHUNK) {
        const slice = userIds.slice(i, i + ID_CHUNK);
        const where = { userId: { in: slice }, ...createdAt };
        const groups = await Promise.all([
            prisma.wingoBet.groupBy({
                by: ["userId"],
                where,
                _sum: { betAmount: true },
                _count: { _all: true },
            }),
            prisma.fiveDBet.groupBy({
                by: ["userId"],
                where,
                _sum: { betAmount: true },
                _count: { _all: true },
            }),
            prisma.k3Bet.groupBy({
                by: ["userId"],
                where,
                _sum: { betAmount: true },
                _count: { _all: true },
            }),
            prisma.motoBet.groupBy({
                by: ["userId"],
                where,
                _sum: { betAmount: true },
                _count: { _all: true },
            }),
            prisma.trxWingoBet.groupBy({
                by: ["userId"],
                where,
                _sum: { betAmount: true },
                _count: { _all: true },
            }),
            prisma.inoutBet.groupBy({
                by: ["userId"],
                where: { ...where, isRolledback: false },
                _sum: { betAmount: true },
                _count: { _all: true },
            }),
        ]);
        for (const rows of groups) {
            for (const r of rows) {
                addBetStat(
                    map,
                    r.userId,
                    r._sum.betAmount || 0,
                    r._count._all || 0
                );
            }
        }
    }
    return map;
}

async function depositStatsByUser(
    userIds: string[],
    range?: DateRange
): Promise<Map<string, UserMoneyStat>> {
    const map = new Map<string, UserMoneyStat>();
    if (userIds.length === 0) return map;
    const createdAt = range ? { createdAt: range } : {};
    for (let i = 0; i < userIds.length; i += ID_CHUNK) {
        const slice = userIds.slice(i, i + ID_CHUNK);
        const rows = await prisma.deposit.groupBy({
            by: ["userId"],
            where: {
                userId: { in: slice },
                status: "SUCCESS",
                ...createdAt,
            },
            _sum: { amount: true },
            _count: { _all: true },
        });
        for (const r of rows) {
            map.set(r.userId, {
                amount: r._sum.amount || 0,
                count: r._count._all || 0,
            });
        }
    }
    return map;
}

async function rebateFromStats(
    agentId: string,
    fromUserIds: string[],
    range?: DateRange
): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (fromUserIds.length === 0) return map;
    const createdAt = range ? { createdAt: range } : {};
    for (let i = 0; i < fromUserIds.length; i += ID_CHUNK) {
        const slice = fromUserIds.slice(i, i + ID_CHUNK);
        const rows = await prisma.rebate.groupBy({
            by: ["fromUserId"],
            where: {
                userId: agentId,
                fromUserId: { in: slice },
                settled: true,
                ...createdAt,
            },
            _sum: { amount: true },
        });
        for (const r of rows) {
            if (r.fromUserId) {
                map.set(r.fromUserId, r._sum.amount || 0);
            }
        }
    }
    return map;
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
        "With `date` (IST YYYY-MM-DD): register / SUCCESS deposits / first SUCCESS " +
        "and team betting for that day only — no TeamMetrics write. Agent Commission " +
        "uses today's date for live bet volume.",
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

const agencyHubResponseSchema = z.object({
    success: z.boolean(),
    data: z.object({
        yesterday: teamOverviewSchema,
        lifetime: teamOverviewSchema,
        yesterdayCommission: z.number(),
        weekCommission: z.number(),
    }),
});

const getAgencyHubRoute = createRoute({
    method: "get",
    tags: ["user"],
    path: "/team/hub",
    summary: "Agency hub payload",
    description:
        "Yesterday Direct/Team card, lifetime headcount/income, yesterday commission, this-week rebate sum. One round trip.",
    request: { cookies: authCookie },
    responses: {
        200: {
            content: {
                "application/json": { schema: agencyHubResponseSchema },
            },
            description: "OK",
        },
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

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

async function computeTeamOverview(
    userId: string,
    date?: string
): Promise<OverviewPayload> {
    let range: DateRange;
    if (date) {
        range = {
            gte: parseYmdStartIst(date),
            lt: parseYmdEndExclusiveIst(date),
        };
    }

    const teamMembers = await getTeamMembers(userId);
    const directMembers = teamMembers.filter((m) => m.layer === 1);

    const inRange = (d: Date) =>
        !range || (d >= range.gte && d < range.lt);

    const registered = range
        ? teamMembers.filter((m) => inRange(m.user.createdAt))
        : teamMembers;
    const registeredDirect = registered.filter((m) => m.layer === 1);

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
                userId,
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

    return {
        directTeamSize: registeredDirect.length,
        totalTeamSize: registered.length,
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
}

async function cachedTeamOverview(
    userId: string,
    date?: string
): Promise<OverviewPayload> {
    const cacheKey = date
        ? `${CacheKey.teamOverview(userId)}:${date}`
        : CacheKey.teamOverview(userId);
    const cached = await Cache.get<OverviewPayload>(cacheKey);
    if (cached) return cached;
    const data = await computeTeamOverview(userId, date);
    await Cache.set(cacheKey, data, 30);
    if (!date) {
        void prisma.teamMetrics
            .upsert({
                where: { userId },
                update: {
                    directTeamSize: data.directTeamSize,
                    directTeamBetting: data.directTeamBetting,
                    directTeamDeposit: data.directTeamDeposit,
                    totalTeamSize: data.totalTeamSize,
                    totalTeamBetting: data.totalTeamBetting,
                    totalTeamDeposit: data.totalTeamDeposit,
                    lastUpdated: new Date(),
                },
                create: {
                    userId,
                    directTeamSize: data.directTeamSize,
                    directTeamBetting: data.directTeamBetting,
                    directTeamDeposit: data.directTeamDeposit,
                    totalTeamSize: data.totalTeamSize,
                    totalTeamBetting: data.totalTeamBetting,
                    totalTeamDeposit: data.totalTeamDeposit,
                },
            })
            .catch((e) => logger.warn("Failed to upsert team metrics", e));
    }
    return data;
}

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

            // Short cache (20s). v10 = batched day stats (no per-card 14 queries)
            const mainCacheKey = CacheKey.teamMembers(user.id);
            const fieldKey = `v10-layer:${layer || "all"}-username:${
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

            const rosterIds = filteredMembers.map((m) => m.user.id);
            const [betMap, depMap, rebateMap] = await Promise.all([
                betStatsByUser(rosterIds, dayRange),
                depositStatsByUser(rosterIds, dayRange),
                rebateFromStats(user.id, rosterIds, dayRange),
            ]);

            // Date filter: only people who actually played/deposited/paid
            // rebate on that IST day — not the live roster (today's joins).
            if (dayRange) {
                filteredMembers = filteredMembers.filter((m) => {
                    const id = m.user.id;
                    return (
                        (betMap.get(id)?.count ?? 0) > 0 ||
                        (depMap.get(id)?.count ?? 0) > 0 ||
                        rebateMap.has(id)
                    );
                });
            }

            // Paginate
            const paginatedMembers = filteredMembers.slice(
                skip,
                skip + limitNum
            );
            const total = filteredMembers.length;
            const totalPages = Math.max(1, Math.ceil(total / limitNum) || 1);
            const filteredIds = filteredMembers.map((m) => m.user.id);

            const isoCreated = (d: Date | string) =>
                d instanceof Date ? d.toISOString() : String(d);

            const membersWithStats = paginatedMembers.map(
                ({ user: member, layer: L }) => {
                    const bets = betMap.get(member.id);
                    const deps = depMap.get(member.id);
                    return {
                        id: member.id,
                        username: member.username,
                        mobileNumber: member.mobileNumber ?? undefined,
                        email: member.email ?? undefined,
                        serialNumber: member.serialNumber,
                        layer: L,
                        totalBetting: bets?.amount ?? 0,
                        betCount: bets?.count ?? 0,
                        totalDeposit: deps?.amount ?? 0,
                        commissionGenerated: rebateMap.get(member.id) ?? 0,
                        createdAt: isoCreated(member.createdAt),
                    };
                }
            );

            let summaryBetting = 0;
            let summaryDeposit = 0;
            let summaryDepositCount = 0;
            let depositors = 0;
            let bettors = 0;
            for (const id of filteredIds) {
                const b = betMap.get(id);
                if (b && b.count > 0) {
                    summaryBetting += b.amount;
                    bettors += 1;
                }
                const d = depMap.get(id);
                if (d && d.count > 0) {
                    summaryDeposit += d.amount;
                    summaryDepositCount += d.count;
                    depositors += 1;
                }
            }

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
                    depositCount: summaryDepositCount,
                    totalBetting: summaryBetting,
                    totalDeposit: summaryDeposit,
                    depositors,
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
            if (date && !isValidYmd(date)) {
                return apiError(
                    c,
                    "Invalid date format. Use YYYY-MM-DD",
                    HTTP_STATUS.BAD_REQUEST
                );
            }
            const data = await cachedTeamOverview(user.id, date);
            return c.json({ success: true, data }, HTTP_STATUS.OK);
        } catch (error) {
            logger.error("Error fetching team overview:", error);
            return apiError(
                c,
                "Failed to fetch team overview",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.openapi(getAgencyHubRoute, async (c) => {
        try {
            const user = c.get("user");
            const hubKey = `user:${user.id}:agency-hub`;
            const cached = await Cache.get<{
                yesterday: OverviewPayload;
                lifetime: OverviewPayload;
                yesterdayCommission: number;
                weekCommission: number;
            }>(hubKey);
            if (cached) {
                return c.json({ success: true, data: cached }, HTTP_STATUS.OK);
            }
            const today = ymdIst();
            const yest = shiftYmdIst(today, -1);
            const weekStart = shiftYmdIst(today, -6);
            const [lifetime, yesterday, yesterdayCommission, weekCommission] =
                await Promise.all([
                    cachedTeamOverview(user.id),
                    cachedTeamOverview(user.id, yest),
                    sumRebateAmount({
                        userId: user.id,
                        startYmd: yest,
                        endYmd: yest,
                        settled: true,
                    }),
                    sumRebateAmount({
                        userId: user.id,
                        startYmd: weekStart,
                        endYmd: today,
                        settled: "all",
                    }),
                ]);
            const data = {
                yesterday,
                lifetime,
                yesterdayCommission,
                weekCommission,
            };
            await Cache.set(hubKey, data, 30);
            return c.json({ success: true, data }, HTTP_STATUS.OK);
        } catch (error) {
            logger.error("Error fetching agency hub:", error);
            return apiError(
                c,
                "Failed to fetch agency hub",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
