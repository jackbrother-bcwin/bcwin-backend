import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { apiError, CommonResponses } from "@/lib/utils";
import { HTTP_STATUS } from "@/lib/http";
import { authCookie } from "@/schemas";
import { Cache, CacheKey } from "@bcwin/cache";

const logger = new Logger("admin-ip-statistics");

// Response schema
const IpStatisticsSchema = z.object({
    totalActiveIPs: z.number().openapi({
        description: "Count of IPs with activity in last 7 days",
        example: 1250,
    }),
    highRiskIPs: z.number().openapi({
        description: "Count of IPs with HIGH risk level",
        example: 45,
    }),
    blockedIPs: z.number().openapi({
        description: "Count of blacklisted IPs",
        example: 12,
    }),
    activeUsersPercentage: z.number().openapi({
        description: "Percentage of users active in last 24 hours",
        example: 68.5,
    }),
});

const IpStatisticsResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    data: IpStatisticsSchema,
});

const GetIpStatisticsRoute = createRoute({
    method: "get",
    path: "/statistics",
    tags: ["admin"],
    summary: "Get IP intelligence statistics",
    description:
        "Get dashboard statistics for IP intelligence including active IPs, high risk IPs, blocked IPs, and active users percentage",
    request: {
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: IpStatisticsResponseSchema,
                },
            },
            description: "IP statistics retrieved successfully",
        },
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

type StatisticsData = z.infer<typeof IpStatisticsResponseSchema>;

export const ipStatisticsRoutes = (app: OpenAPIHono) => {
    app.openapi(GetIpStatisticsRoute, async (c) => {
        try {
            // Check cache
            const cachedData = await Cache.get<StatisticsData>(
                CacheKey.ipStatistics
            );

            if (cachedData) {
                return c.json(cachedData, HTTP_STATUS.OK);
            }

            // Calculate date thresholds
            const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);

            // Run queries in parallel
            const [
                activeIPsCount,
                highRiskIPsCount,
                blockedIPsCount,
                totalUsers,
                activeUsers,
            ] = await Promise.all([
                // Total Active IPs (with activity in last 7 days)
                prisma.ip.count({
                    where: {
                        lastActivityAt: {
                            gte: last7Days,
                        },
                    },
                }),

                // High Risk IPs
                prisma.ip.count({
                    where: {
                        riskLevel: "HIGH",
                    },
                }),

                // Blocked IPs
                prisma.ip.count({
                    where: {
                        isBlacklisted: true,
                    },
                }),

                // Total users count
                prisma.user.count(),

                // Active users in last 24 hours
                prisma.user.count({
                    where: {
                        lastLoginDate: {
                            gte: last24Hours,
                        },
                    },
                }),
            ]);

            const activeUsersPercentage =
                totalUsers > 0
                    ? parseFloat(((activeUsers / totalUsers) * 100).toFixed(2))
                    : 0;

            const result: StatisticsData = {
                success: true,
                data: {
                    totalActiveIPs: activeIPsCount,
                    highRiskIPs: highRiskIPsCount,
                    blockedIPs: blockedIPsCount,
                    activeUsersPercentage,
                },
            };

            // Cache for 5 minutes
            await Cache.set(CacheKey.ipStatistics, result, 60 * 5);

            return c.json(result, HTTP_STATUS.OK);
        } catch (error) {
            logger.error("Error fetching IP statistics:", error);
            return apiError(
                c,
                "Internal server error",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
