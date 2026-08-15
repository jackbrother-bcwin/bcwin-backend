import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie, page, limit } from "@/schemas";
import { prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";

const logger = new Logger("admin-ip");

// Schemas
const GetIpsQuerySchema = z.object({
    page,
    limit,
    search: z.string().optional().openapi({
        description: "Search by IP address",
        example: "192.168",
    }),
    isBlacklisted: z.enum(["true", "false"]).optional().openapi({
        description: "Filter by blacklisted status",
        example: "false",
    }),
    riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]).optional().openapi({
        description: "Filter by risk level",
        example: "MEDIUM",
    }),
    activityType: z
        .enum(["LOGIN", "REGISTER", "BETTING", "DEPOSIT", "WITHDRAWAL"])
        .optional()
        .openapi({
            description: "Filter by activity type",
            example: "LOGIN",
        }),
    timeRange: z.enum(["TODAY", "THIS_WEEK", "THIS_MONTH"]).optional().openapi({
        description: "Filter by time range",
        example: "TODAY",
    }),
});

const RecentActivitySchema = z.object({
    type: z.string().openapi({
        description: "Activity type",
        example: "LOGIN",
    }),
    count: z.number().openapi({
        description: "Number of activities of this type",
        example: 15,
    }),
    lastOccurrence: z.string().openapi({
        description: "Last time this activity occurred",
        example: "2025-01-03T10:30:00Z",
    }),
});

const IpItemSchema = z.object({
    id: z.string().openapi({
        description: "IP record ID",
        example: "uuid-123",
    }),
    ip: z.string().openapi({
        description: "IP address",
        example: "192.168.1.1",
    }),
    riskLevel: z.string().openapi({
        description: "Risk level (LOW, MEDIUM, HIGH)",
        example: "MEDIUM",
    }),
    isBlacklisted: z.boolean().openapi({
        description: "Is IP blacklisted",
        example: false,
    }),
    reason: z.string().nullable().openapi({
        description: "Blacklist reason",
        example: "Suspicious activity",
    }),
    userCount: z.number().openapi({
        description: "Number of users using this IP",
        example: 3,
    }),
    recentActivities: z.array(RecentActivitySchema).openapi({
        description: "Recent activities from this IP",
    }),
    lastActivityAt: z.string().nullable().openapi({
        description: "Last activity timestamp",
        example: "2025-01-03T10:30:00Z",
    }),
    createdAt: z.string().openapi({
        description: "IP first seen timestamp",
        example: "2025-01-12T10:30:00Z",
    }),
    updatedAt: z.string().openapi({
        description: "IP last updated timestamp",
        example: "2025-01-12T10:30:00Z",
    }),
});

const GetIpsResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    ips: z.array(IpItemSchema),
    total: z.number().openapi({
        description: "Total number of IPs",
        example: 50,
    }),
    currentPage: z.number().openapi({
        description: "Current page number",
        example: 1,
    }),
    totalPages: z.number().openapi({
        description: "Total number of pages",
        example: 5,
    }),
});

const UserItemSchema = z.object({
    id: z.string().openapi({
        description: "User ID",
        example: "uuid-123",
    }),
    serialNumber: z.number().openapi({
        description: "User serial number",
        example: 8400,
    }),
    username: z.string().openapi({
        description: "Username",
        example: "user123",
    }),
    mobileNumber: z.string().openapi({
        description: "Mobile number",
        example: "9876543210",
    }),
    balance: z.number().openapi({
        description: "User balance",
        example: 1000.5,
    }),
    isBanned: z.boolean().openapi({
        description: "Is user banned",
        example: false,
    }),
    role: z.string().openapi({
        description: "User role",
        example: "USER",
    }),
    createdAt: z.string().openapi({
        description: "Account creation timestamp",
        example: "2025-01-12T10:30:00Z",
    }),
});

const GetIpDetailsResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    ip: IpItemSchema,
    users: z.array(UserItemSchema),
});

const BlacklistIpBodySchema = z.object({
    reason: z.string().min(1).openapi({
        description: "Reason for blacklisting",
        example: "Multiple suspicious accounts detected",
    }),
});

const BlacklistIpResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the blacklist was successful",
        example: true,
    }),
    message: z.string().openapi({
        description: "Success message",
        example: "IP blacklisted successfully",
    }),
});

const WhitelistIpResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the whitelist was successful",
        example: true,
    }),
    message: z.string().openapi({
        description: "Success message",
        example: "IP whitelisted successfully",
    }),
});

// Routes
const getIpsRoute = createRoute({
    method: "get",
    path: "/list",
    tags: ["admin"],
    summary: "Get IPs list",
    description:
        "Get a paginated list of IPs with user counts and optional filters",
    request: {
        query: GetIpsQuerySchema,
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: GetIpsResponseSchema,
                },
            },
            description: "List of IPs",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

const getIpDetailsRoute = createRoute({
    method: "get",
    path: "/:ip",
    tags: ["admin"],
    summary: "Get IP details",
    description:
        "Get detailed information about a specific IP including all users using it",
    request: {
        params: z.object({
            ip: z.string().openapi({
                description: "IP address",
                example: "192.168.1.1",
            }),
        }),
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: GetIpDetailsResponseSchema,
                },
            },
            description: "IP details with users",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

const blacklistIpRoute = createRoute({
    method: "post",
    path: "/:ip/blacklist",
    tags: ["admin"],
    summary: "Blacklist IP",
    description: "Add an IP to the blacklist",
    request: {
        params: z.object({
            ip: z.string().openapi({
                description: "IP address",
                example: "192.168.1.1",
            }),
        }),
        body: {
            content: {
                "application/json": {
                    schema: BlacklistIpBodySchema,
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: BlacklistIpResponseSchema,
                },
            },
            description: "IP blacklisted successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

const whitelistIpRoute = createRoute({
    method: "post",
    path: "/:ip/whitelist",
    tags: ["admin"],
    summary: "Whitelist IP",
    description: "Remove an IP from the blacklist",
    request: {
        params: z.object({
            ip: z.string().openapi({
                description: "IP address",
                example: "192.168.1.1",
            }),
        }),
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: WhitelistIpResponseSchema,
                },
            },
            description: "IP removed from blacklist successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

// Route handlers
export const ipManagementRoutes = (app: OpenAPIHono) => {
    // List IPs
    app.openapi(getIpsRoute, async (c) => {
        try {
            const {
                page: pageNum,
                limit: limitNum,
                search,
                isBlacklisted,
                riskLevel,
                activityType,
                timeRange,
            } = c.req.valid("query");
            const skip = (pageNum - 1) * limitNum;

            // Check cache using hash-based caching
            const mainCacheKey = CacheKey.adminIps;
            const fieldKey = `search:${search || "none"}-blacklisted:${
                isBlacklisted || "all"
            }-risk:${riskLevel || "all"}-activity:${
                activityType || "all"
            }-time:${timeRange || "all"}-page:${pageNum}-limit:${limitNum}`;

            const cachedData = await Cache.hget<{
                ips: Array<{
                    id: string;
                    ip: string;
                    riskLevel: string;
                    isBlacklisted: boolean;
                    reason: string | null;
                    userCount: number;
                    recentActivities: Array<{
                        type: string;
                        count: number;
                        lastOccurrence: string;
                    }>;
                    lastActivityAt: string | null;
                    createdAt: string;
                    updatedAt: string;
                }>;
                total: number;
                currentPage: number;
                totalPages: number;
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

            // Build where clause
            const where: any = {};

            if (search) {
                where.ip = { contains: search };
            }

            if (isBlacklisted !== undefined) {
                where.isBlacklisted = isBlacklisted === "true";
            }

            if (riskLevel) {
                where.riskLevel = riskLevel;
            }

            // Calculate time range for filtering
            let timeRangeDate: Date | undefined;
            if (timeRange) {
                const now = new Date();
                if (timeRange === "TODAY") {
                    timeRangeDate = new Date(now.setHours(0, 0, 0, 0));
                } else if (timeRange === "THIS_WEEK") {
                    const dayOfWeek = now.getDay();
                    const diff = now.getDate() - dayOfWeek;
                    timeRangeDate = new Date(now.setDate(diff));
                    timeRangeDate.setHours(0, 0, 0, 0);
                } else if (timeRange === "THIS_MONTH") {
                    timeRangeDate = new Date(
                        now.getFullYear(),
                        now.getMonth(),
                        1
                    );
                }
            }

            if (timeRangeDate) {
                where.lastActivityAt = {
                    gte: timeRangeDate,
                };
            }

            // If activityType filter is provided, we need to join with IpActivity
            let ipList: string[] | undefined;
            if (activityType) {
                const ipsWithActivity = await prisma.ipActivity.findMany({
                    where: {
                        activityType,
                        ...(timeRangeDate && {
                            createdAt: { gte: timeRangeDate },
                        }),
                    },
                    distinct: ["ip"],
                    select: { ip: true },
                });
                ipList = ipsWithActivity.map((a) => a.ip);
                if (ipList.length === 0) {
                    // No IPs match the activity filter
                    return c.json(
                        {
                            success: true,
                            ips: [],
                            total: 0,
                            currentPage: pageNum,
                            totalPages: 0,
                        },
                        HTTP_STATUS.OK
                    );
                }
                where.ip = {
                    in: ipList,
                    ...(search && { contains: search }),
                };
            }

            const [ips, total] = await Promise.all([
                prisma.ip.findMany({
                    where,
                    take: limitNum,
                    skip,
                    orderBy: {
                        updatedAt: "desc",
                    },
                    select: {
                        id: true,
                        ip: true,
                        riskLevel: true,
                        isBlacklisted: true,
                        reason: true,
                        lastActivityAt: true,
                        createdAt: true,
                        updatedAt: true,
                    },
                }),
                prisma.ip.count({ where }),
            ]);

            // Get user counts for each IP
            const ipAddresses = ips.map((ip) => ip.ip);
            const userCounts = await prisma.user.groupBy({
                by: ["ip"],
                where: {
                    ip: {
                        in: ipAddresses,
                    },
                },
                _count: true,
            });

            const userCountMap = new Map(
                userCounts.map((uc) => [uc.ip, uc._count])
            );

            // Get recent activities for each IP
            const recentActivitiesData = await prisma.ipActivity.groupBy({
                by: ["ip", "activityType"],
                where: {
                    ip: {
                        in: ipAddresses,
                    },
                    createdAt: {
                        gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
                    },
                },
                _count: true,
                _max: {
                    createdAt: true,
                },
            });

            // Organize activities by IP
            const activitiesMap = new Map<
                string,
                Array<{
                    type: string;
                    count: number;
                    lastOccurrence: string;
                }>
            >();

            recentActivitiesData.forEach((activity) => {
                if (!activitiesMap.has(activity.ip)) {
                    activitiesMap.set(activity.ip, []);
                }
                activitiesMap.get(activity.ip)!.push({
                    type: activity.activityType,
                    count: activity._count,
                    lastOccurrence:
                        activity._max.createdAt?.toISOString() || "",
                });
            });

            const totalPages = Math.ceil(total / limitNum);

            const result = {
                ips: ips.map((ip) => ({
                    id: ip.id,
                    ip: ip.ip,
                    riskLevel: ip.riskLevel,
                    isBlacklisted: ip.isBlacklisted,
                    reason: ip.reason,
                    userCount: userCountMap.get(ip.ip) || 0,
                    recentActivities: activitiesMap.get(ip.ip) || [],
                    lastActivityAt: ip.lastActivityAt?.toISOString() || null,
                    createdAt: ip.createdAt.toISOString(),
                    updatedAt: ip.updatedAt.toISOString(),
                })),
                total,
                currentPage: pageNum,
                totalPages,
            };

            // Cache for 3 minutes
            await Cache.hset(mainCacheKey, fieldKey, result, 60 * 3);

            return c.json(
                {
                    success: true,
                    ...result,
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

    // Get IP details
    app.openapi(getIpDetailsRoute, async (c) => {
        try {
            const { ip: ipAddress } = c.req.valid("param");

            const ipData = await prisma.ip.findUnique({
                where: { ip: ipAddress },
            });

            if (!ipData) {
                return apiError(c, "IP not found", HTTP_STATUS.BAD_REQUEST);
            }

            const users = await prisma.user.findMany({
                where: { ip: ipAddress },
                select: {
                    id: true,
                    serialNumber: true,
                    username: true,
                    mobileNumber: true,
                    balance: true,
                    isBanned: true,
                    role: true,
                    createdAt: true,
                },
                orderBy: {
                    createdAt: "desc",
                },
            });

            // Get user count
            const userCount = users.length;

            // Get recent activities for this IP
            const recentActivities = await prisma.ipActivity.groupBy({
                by: ["activityType"],
                where: {
                    ip: ipAddress,
                    createdAt: {
                        gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
                    },
                },
                _count: true,
                _max: {
                    createdAt: true,
                },
            });

            const formattedActivities = recentActivities.map((activity) => ({
                type: activity.activityType,
                count: activity._count,
                lastOccurrence: activity._max.createdAt?.toISOString() || "",
            }));

            return c.json(
                {
                    success: true,
                    ip: {
                        id: ipData.id,
                        ip: ipData.ip,
                        riskLevel: ipData.riskLevel,
                        isBlacklisted: ipData.isBlacklisted,
                        reason: ipData.reason,
                        userCount,
                        recentActivities: formattedActivities,
                        lastActivityAt:
                            ipData.lastActivityAt?.toISOString() || null,
                        createdAt: ipData.createdAt.toISOString(),
                        updatedAt: ipData.updatedAt.toISOString(),
                    },
                    users: users.map((user) => ({
                        id: user.id,
                        serialNumber: user.serialNumber,
                        username: user.username,
                        mobileNumber: user.mobileNumber,
                        balance: user.balance,
                        isBanned: user.isBanned,
                        role: user.role,
                        createdAt: user.createdAt.toISOString(),
                    })),
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

    // Blacklist IP
    app.openapi(blacklistIpRoute, async (c) => {
        try {
            const { ip: ipAddress } = c.req.valid("param");
            const { reason } = c.req.valid("json");

            const ipData = await prisma.ip.findUnique({
                where: { ip: ipAddress },
            });

            if (!ipData) {
                return apiError(c, "IP not found", HTTP_STATUS.BAD_REQUEST);
            }

            if (ipData.isBlacklisted) {
                return apiError(
                    c,
                    "IP is already blacklisted",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            await prisma.ip.update({
                where: { ip: ipAddress },
                data: {
                    isBlacklisted: true,
                    reason,
                },
            });

            // Invalidate cache
            await Cache.del(CacheKey.adminIps);

            return c.json(
                {
                    success: true,
                    message: "IP blacklisted successfully",
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

    // Whitelist IP
    app.openapi(whitelistIpRoute, async (c) => {
        try {
            const { ip: ipAddress } = c.req.valid("param");

            const ipData = await prisma.ip.findUnique({
                where: { ip: ipAddress },
            });

            if (!ipData) {
                return apiError(c, "IP not found", HTTP_STATUS.BAD_REQUEST);
            }

            if (!ipData.isBlacklisted) {
                return apiError(
                    c,
                    "IP is not blacklisted",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            await prisma.ip.update({
                where: { ip: ipAddress },
                data: {
                    isBlacklisted: false,
                    reason: null,
                },
            });

            // Invalidate cache
            await Cache.del(CacheKey.adminIps);

            return c.json(
                {
                    success: true,
                    message: "IP removed from blacklist successfully",
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
