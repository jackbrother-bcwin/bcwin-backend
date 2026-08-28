import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import { prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import { getTeamMembers } from "./helpers";

const logger = new Logger("admin-users-yesterday-stats");

// IST offset: +5:30
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Get the IST "YYYY-MM-DD" for a JS Date. */
function ymdIst(d: Date = new Date()): string {
    const istMs = d.getTime() + IST_OFFSET_MS;
    const istDate = new Date(istMs);
    const y = istDate.getUTCFullYear();
    const m = String(istDate.getUTCMonth() + 1).padStart(2, "0");
    const day = String(istDate.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

/** Get yesterday's IST date string and its UTC boundaries. */
function getYesterdayBoundaries() {
    const todayIst = ymdIst(new Date());
    // Yesterday IST
    const todayStart = new Date(`${todayIst}T00:00:00+05:30`);
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayYmd = ymdIst(yesterdayStart);

    const gte = new Date(`${yesterdayYmd}T00:00:00+05:30`);
    const lt = new Date(`${todayIst}T00:00:00+05:30`);

    return { date: yesterdayYmd, gte, lt };
}

// ── Schemas ──

const levelStatsSchema = z.object({
    level: z.union([z.string(), z.number()]).openapi({
        description: 'Level identifier: "self" or 1–6',
        example: "self",
    }),
    memberCount: z.number().openapi({
        description: "Number of members at this level",
        example: 1,
    }),
    depositCount: z.number().openapi({
        description: "Number of successful deposits yesterday",
        example: 5,
    }),
    depositAmount: z.number().openapi({
        description: "Total deposit amount yesterday",
        example: 5000,
    }),
    withdrawCount: z.number().openapi({
        description: "Number of successful withdrawals yesterday",
        example: 2,
    }),
    withdrawAmount: z.number().openapi({
        description: "Total withdrawal amount yesterday",
        example: 2000,
    }),
    betCount: z.number().openapi({
        description: "Number of bets placed yesterday (all game types)",
        example: 15,
    }),
    betAmount: z.number().openapi({
        description: "Total bet amount yesterday (all game types)",
        example: 3500,
    }),
});

const yesterdayStatsResponseSchema = z.object({
    success: z.boolean(),
    date: z
        .string()
        .openapi({ description: "Yesterday's IST date", example: "2026-08-27" }),
    levels: z.array(levelStatsSchema),
});

// ── Route definition ──

const getYesterdayStatsRoute = createRoute({
    method: "get",
    path: "/:id/yesterday-stats",
    tags: ["admin"],
    summary: "Get user yesterday stats per downlink level",
    description:
        "Returns yesterday's (IST midnight-to-midnight) deposit, withdraw, and bet " +
        "counts and amounts for the user (self) and each downlink level (1–6).",
    request: {
        params: z.object({
            id: z.string().openapi({
                description: "User ID",
                example: "uuid-123",
            }),
        }),
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: yesterdayStatsResponseSchema,
                },
            },
            description: "Yesterday's stats per level",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

// ── Helpers ──

async function computeLevelStats(
    userIds: string[],
    gte: Date,
    lt: Date
): Promise<{
    depositCount: number;
    depositAmount: number;
    withdrawCount: number;
    withdrawAmount: number;
    betCount: number;
    betAmount: number;
}> {
    if (userIds.length === 0) {
        return {
            depositCount: 0,
            depositAmount: 0,
            withdrawCount: 0,
            withdrawAmount: 0,
            betCount: 0,
            betAmount: 0,
        };
    }

    const dateFilter = { gte, lt };

    const [
        deposits,
        withdrawals,
        wingoBets,
        fiveDBets,
        k3Bets,
        motoBets,
        trxWingoBets,
        inoutBets,
    ] = await Promise.all([
        prisma.deposit.aggregate({
            where: {
                userId: { in: userIds },
                status: "SUCCESS",
                createdAt: dateFilter,
            },
            _count: { _all: true },
            _sum: { amount: true },
        }),
        prisma.withdraw.aggregate({
            where: {
                userId: { in: userIds },
                status: "SUCCESS",
                createdAt: dateFilter,
            },
            _count: { _all: true },
            _sum: { amount: true },
        }),
        prisma.wingoBet.aggregate({
            where: { userId: { in: userIds }, createdAt: dateFilter },
            _count: { _all: true },
            _sum: { betAmount: true },
        }),
        prisma.fiveDBet.aggregate({
            where: { userId: { in: userIds }, createdAt: dateFilter },
            _count: { _all: true },
            _sum: { betAmount: true },
        }),
        prisma.k3Bet.aggregate({
            where: { userId: { in: userIds }, createdAt: dateFilter },
            _count: { _all: true },
            _sum: { betAmount: true },
        }),
        prisma.motoBet.aggregate({
            where: { userId: { in: userIds }, createdAt: dateFilter },
            _count: { _all: true },
            _sum: { betAmount: true },
        }),
        prisma.trxWingoBet.aggregate({
            where: { userId: { in: userIds }, createdAt: dateFilter },
            _count: { _all: true },
            _sum: { betAmount: true },
        }),
        prisma.inoutBet.aggregate({
            where: { userId: { in: userIds }, createdAt: dateFilter },
            _count: { _all: true },
            _sum: { betAmount: true },
        }),
    ]);

    const betCount =
        wingoBets._count._all +
        fiveDBets._count._all +
        k3Bets._count._all +
        motoBets._count._all +
        trxWingoBets._count._all +
        inoutBets._count._all;

    const betAmount =
        (wingoBets._sum.betAmount || 0) +
        (fiveDBets._sum.betAmount || 0) +
        (k3Bets._sum.betAmount || 0) +
        (motoBets._sum.betAmount || 0) +
        (trxWingoBets._sum.betAmount || 0) +
        (inoutBets._sum.betAmount || 0);

    return {
        depositCount: deposits._count._all,
        depositAmount: deposits._sum.amount || 0,
        withdrawCount: withdrawals._count._all,
        withdrawAmount: withdrawals._sum.amount || 0,
        betCount,
        betAmount,
    };
}

// ── Route handler ──

export const yesterdayStatsRoutes = (app: OpenAPIHono) => {
    app.openapi(getYesterdayStatsRoute, async (c) => {
        try {
            const { id } = c.req.valid("param");

            // Verify user exists
            const user = await prisma.user.findUnique({
                where: { id },
                select: { id: true, isDemo: true },
            });

            if (!user) {
                return apiError(c, "User not found", HTTP_STATUS.BAD_REQUEST);
            }

            const { date, gte, lt } = getYesterdayBoundaries();

            // Check cache
            const cacheKey = `admin:user-yesterday-stats:${id}:${date}`;
            const cached = await Cache.get<{
                date: string;
                levels: z.infer<typeof levelStatsSchema>[];
            }>(cacheKey);

            if (cached) {
                return c.json(
                    { success: true, ...cached },
                    HTTP_STATUS.OK
                );
            }

            // Demo users: return zeros
            if (user.isDemo) {
                const emptyLevel = {
                    depositCount: 0,
                    depositAmount: 0,
                    withdrawCount: 0,
                    withdrawAmount: 0,
                    betCount: 0,
                    betAmount: 0,
                };
                const levels = [
                    { level: "self" as const, memberCount: 1, ...emptyLevel },
                    ...Array.from({ length: 6 }, (_, i) => ({
                        level: i + 1,
                        memberCount: 0,
                        ...emptyLevel,
                    })),
                ];
                const result = { date, levels };
                await Cache.set(cacheKey, result, 60 * 5);
                return c.json({ success: true, ...result }, HTTP_STATUS.OK);
            }

            // Fetch team members (levels 1–6)
            const teamMembers = await getTeamMembers(id, 6);

            // Group by level
            const levelMap: Record<number, string[]> = {};
            for (let l = 1; l <= 6; l++) {
                levelMap[l] = [];
            }
            for (const { user: member, layer } of teamMembers) {
                if (levelMap[layer]) {
                    levelMap[layer].push(member.id);
                }
            }

            // Compute stats for self + each level in parallel
            const [selfStats, ...levelStats] = await Promise.all([
                computeLevelStats([id], gte, lt),
                ...Array.from({ length: 6 }, (_, i) =>
                    computeLevelStats(levelMap[i + 1], gte, lt)
                ),
            ]);

            const levels = [
                {
                    level: "self" as const,
                    memberCount: 1,
                    ...selfStats,
                },
                ...levelStats.map((stats, i) => ({
                    level: i + 1,
                    memberCount: levelMap[i + 1].length,
                    ...stats,
                })),
            ];

            const result = { date, levels };
            await Cache.set(cacheKey, result, 60 * 5);

            return c.json(
                { success: true, ...result },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error fetching yesterday stats:", error);
            return apiError(
                c,
                "Internal server error",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
