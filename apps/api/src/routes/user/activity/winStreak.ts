import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";

const logger = new Logger("win-streak-progress");

const winStreakRuleSchema = z.object({
    id: z.string().uuid(),
    consecutiveWins: z.number().int(),
    bonusPercentage: z.number(),
    isActive: z.boolean(),
});

const winStreakProgressResponseSchema = z.object({
    success: z.boolean(),
    data: z.object({
        currentStreak: z.number().int(),
        streakWinAmount: z.number(),
        lastBetGame: z.string().nullable(),
        lastBetAt: z.string().datetime().nullable(),
        rules: z.array(winStreakRuleSchema).describe("All active win streak rules ordered by consecutiveWins"),
        recentBonuses: z.array(
            z.object({
                id: z.string(),
                amount: z.number(),
                metadata: z.any(),
                createdAt: z.string().datetime(),
            })
        ).describe("Last 10 WIN_STREAK bonuses received"),
    }),
});

const getWinStreakProgressRoute = createRoute({
    method: "get",
    tags: ["user"],
    path: "/win-streak",
    summary: "Get win streak bonus progress",
    description:
        "Returns the user's current win streak, accumulated winnings, active rules, and recent win streak bonuses",
    request: {
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: winStreakProgressResponseSchema,
                },
            },
            description: "Successfully retrieved win streak progress",
        },
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

export const winStreakProgressRoutes = (app: OpenAPIHono) => {
    app.openapi(getWinStreakProgressRoute, async (c) => {
        try {
            const user = c.get("user");

            const [streakData, rules, recentBonuses] = await Promise.all([
                prisma.userWinStreak.findUnique({
                    where: { userId: user.id },
                    select: {
                        currentStreak: true,
                        streakWinAmount: true,
                        lastBetGame: true,
                        lastBetAt: true,
                    },
                }),
                prisma.winStreakRule.findMany({
                    where: { isActive: true },
                    orderBy: { consecutiveWins: "asc" },
                    select: {
                        id: true,
                        consecutiveWins: true,
                        bonusPercentage: true,
                        isActive: true,
                    },
                }),
                prisma.activityBonus.findMany({
                    where: {
                        userId: user.id,
                        type: "WIN_STREAK",
                    },
                    orderBy: { createdAt: "desc" },
                    take: 10,
                    select: {
                        id: true,
                        amount: true,
                        metadata: true,
                        createdAt: true,
                    },
                }),
            ]);

            return c.json(
                {
                    success: true,
                    data: {
                        currentStreak: streakData?.currentStreak ?? 0,
                        streakWinAmount: streakData?.streakWinAmount ?? 0,
                        lastBetGame: streakData?.lastBetGame ?? null,
                        lastBetAt: streakData?.lastBetAt?.toISOString() ?? null,
                        rules,
                        recentBonuses: recentBonuses.map((b) => ({
                            ...b,
                            createdAt: b.createdAt.toISOString(),
                        })),
                    },
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error fetching win streak progress:", error);
            return apiError(
                c,
                "Failed to fetch win streak progress",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
