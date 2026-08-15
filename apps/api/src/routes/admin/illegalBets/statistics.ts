import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { apiError, CommonResponses } from "@/lib/utils";
import { HTTP_STATUS } from "@/lib/http";
import { authCookie } from "@/schemas";
import { Cache, CacheKey } from "@bcwin/cache";
import { REAL_USER_RELATION, REAL_USER_WHERE } from "@/lib/realUserFilter";

const logger = new Logger("admin-illegal-bets-statistics");

// Response schemas
const CardStatisticsSchema = z.object({
    totalViolations: z.number().openapi({
        description: "Total count of all illegal bets",
        example: 150,
    }),
    activeViolators: z.number().openapi({
        description:
            "Count of distinct users with illegal bets in last 24 hours",
        example: 25,
    }),
    lockedAccounts: z.number().openapi({
        description: "Count of banned users who have illegal bets",
        example: 10,
    }),
    violationRate: z.number().openapi({
        description: "Average illegal bets per violating user",
        example: 6.0,
    }),
});

const ViolationsByGameSchema = z.object({
    wingo: z.number().openapi({ example: 45 }),
    k3: z.number().openapi({ example: 38 }),
    "5d": z.number().openapi({ example: 42 }),
    trx: z.number().openapi({ example: 25 }),
    moto: z.number().openapi({ example: 0 }),
});

const RiskLevelAnalysisSchema = z.object({
    lowRisk: z.number().openapi({
        description: "Percentage of users with 1-3 violations",
        example: 60,
    }),
    mediumRisk: z.number().openapi({
        description: "Percentage of users with 4-7 violations",
        example: 30,
    }),
    highRisk: z.number().openapi({
        description: "Percentage of users with 8+ violations",
        example: 10,
    }),
});

const IllegalBetsStatisticsResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    data: z.object({
        cards: CardStatisticsSchema,
        violationsByGame: ViolationsByGameSchema,
        riskLevelAnalysis: RiskLevelAnalysisSchema,
    }),
});

const GetIllegalBetsStatisticsRoute = createRoute({
    method: "get",
    path: "/statistics",
    tags: ["admin"],
    summary: "Get illegal bets statistics",
    description:
        "Get comprehensive statistics for illegal bets including card metrics, violations by game, and risk level analysis",
    request: {
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: IllegalBetsStatisticsResponseSchema,
                },
            },
            description: "Illegal bets statistics retrieved successfully",
        },
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

type StatisticsData = z.infer<typeof IllegalBetsStatisticsResponseSchema>;

export const illegalBetsStatisticsRoutes = (app: OpenAPIHono) => {
    app.openapi(GetIllegalBetsStatisticsRoute, async (c) => {
        try {
            // Check cache
            const cachedData = await Cache.get<StatisticsData>(
                CacheKey.illegalBetsStatistics
            );

            if (cachedData) {
                return c.json(cachedData, HTTP_STATUS.OK);
            }

            // Calculate date for last 24 hours
            const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);

            // 1. Card Statistics
            const [
                totalViolations,
                activeViolatorsResult,
                lockedAccountsResult,
                totalViolators,
            ] = await Promise.all([
                // Total violations
                prisma.illegalBet.count({
                    where: REAL_USER_RELATION,
                }),

                // Active violators (last 24 hours)
                prisma.illegalBet.groupBy({
                    by: ["userId"],
                    where: {
                        createdAt: {
                            gte: last24Hours,
                        },
                        ...REAL_USER_RELATION,
                    },
                }),

                // Locked accounts with illegal bets
                prisma.user.count({
                    where: {
                        ...REAL_USER_WHERE,
                        isBanned: true,
                        illegalBets: {
                            some: {},
                        },
                    },
                }),

                // Total distinct violators for violation rate
                prisma.illegalBet.groupBy({
                    by: ["userId"],
                    where: REAL_USER_RELATION,
                }),
            ]);

            const activeViolators = activeViolatorsResult.length;
            const violationRate =
                totalViolators.length > 0
                    ? totalViolations / totalViolators.length
                    : 0;

            // 2. Violations by Game
            const violationsByGameResult = await prisma.illegalBet.groupBy({
                by: ["betGame"],
                where: REAL_USER_RELATION,
                _count: true,
            });

            const violationsByGame = {
                wingo: 0,
                k3: 0,
                "5d": 0,
                trx: 0,
                moto: 0,
            };

            violationsByGameResult.forEach((item) => {
                const game = item.betGame.toLowerCase();
                if (game === "wingo") violationsByGame.wingo = item._count;
                else if (game === "k3") violationsByGame.k3 = item._count;
                else if (game === "5d") violationsByGame["5d"] = item._count;
                else if (game === "trx" || game === "trxwingo")
                    violationsByGame.trx = item._count;
                else if (game === "moto") violationsByGame.moto = item._count;
            });

            // 3. Risk Level Analysis
            // Get violation count per user
            const violationsPerUser = await prisma.illegalBet.groupBy({
                by: ["userId"],
                where: REAL_USER_RELATION,
                _count: true,
            });

            let lowRisk = 0;
            let mediumRisk = 0;
            let highRisk = 0;

            violationsPerUser.forEach((user) => {
                const count = user._count;
                if (count >= 1 && count <= 3) lowRisk++;
                else if (count >= 4 && count <= 7) mediumRisk++;
                else if (count >= 8) highRisk++;
            });

            const totalUsers = violationsPerUser.length;
            const riskLevelAnalysis = {
                lowRisk:
                    totalUsers > 0
                        ? parseFloat(((lowRisk / totalUsers) * 100).toFixed(2))
                        : 0,
                mediumRisk:
                    totalUsers > 0
                        ? parseFloat(
                              ((mediumRisk / totalUsers) * 100).toFixed(2)
                          )
                        : 0,
                highRisk:
                    totalUsers > 0
                        ? parseFloat(((highRisk / totalUsers) * 100).toFixed(2))
                        : 0,
            };

            const result: StatisticsData = {
                success: true,
                data: {
                    cards: {
                        totalViolations,
                        activeViolators,
                        lockedAccounts: lockedAccountsResult,
                        violationRate: parseFloat(violationRate.toFixed(2)),
                    },
                    violationsByGame,
                    riskLevelAnalysis,
                },
            };

            // Cache for 5 minutes
            await Cache.set(CacheKey.illegalBetsStatistics, result, 60 * 5);

            return c.json(result, HTTP_STATUS.OK);
        } catch (error) {
            logger.error("Error fetching illegal bets statistics:", error);
            return apiError(
                c,
                "Internal server error",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
