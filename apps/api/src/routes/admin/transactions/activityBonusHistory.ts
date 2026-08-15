import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie, limit, page } from "@/schemas";
import { prisma, ActivityBonusType, ActivityBonusStatus } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";

const logger = new Logger("admin-activity-bonus-history");

// Query schema
const GetActivityBonusHistoryQuerySchema = z.object({
    page,
    limit,
    userId: z.string().optional().openapi({
        description: "Filter by user ID",
        example: "user-123",
    }),
    type: z.nativeEnum(ActivityBonusType).optional().openapi({
        description: "Filter by activity bonus type",
        example: "DAILY",
    }),
    status: z.nativeEnum(ActivityBonusStatus).optional().openapi({
        description: "Filter by activity bonus status",
        example: "COLLECTED",
    }),
});

// Activity bonus item schema
const ActivityBonusItemSchema = z.object({
    id: z.string().openapi({
        description: "Activity bonus ID",
        example: "uuid-123",
    }),
    userId: z.string().openapi({
        description: "User ID",
        example: "user-123",
    }),
    user: z.object({
        id: z.string().openapi({
            description: "User ID",
            example: "user-123",
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
            description: "User mobile number",
            example: "9876543210",
        }),
    }),
    type: z.nativeEnum(ActivityBonusType).openapi({
        description: "Activity bonus type",
        example: "DAILY",
    }),
    status: z.nativeEnum(ActivityBonusStatus).openapi({
        description: "Activity bonus status",
        example: "COLLECTED",
    }),
    amount: z.number().openapi({
        description: "Bonus amount",
        example: 100,
    }),
    metadata: z.record(z.string(), z.any()).optional().openapi({
        description: "Additional metadata",
    }),
    expiresAt: z.string().nullable().openapi({
        description: "Expiration timestamp",
        example: "2025-01-13T10:30:00Z",
    }),
    claimAt: z.string().nullable().openapi({
        description: "Claim timestamp",
        example: "2025-01-12T10:30:00Z",
    }),
    createdAt: z.string().openapi({
        description: "Creation timestamp",
        example: "2025-01-12T10:30:00Z",
    }),
});

// Response schema
const GetActivityBonusHistoryResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    activityBonuses: z.array(ActivityBonusItemSchema),
    total: z.number().openapi({
        description: "Total number of activity bonuses",
        example: 100,
    }),
    currentPage: z.number().openapi({
        description: "Current page number",
        example: 1,
    }),
    totalPages: z.number().openapi({
        description: "Total number of pages",
        example: 4,
    }),
});

const getActivityBonusHistoryRoute = createRoute({
    method: "get",
    path: "/activity-bonus-history",
    tags: ["admin"],
    summary: "List activity bonus history",
    description:
        "Get a paginated list of all activity bonus records with optional filtering by userId, type, and status",
    request: {
        query: GetActivityBonusHistoryQuerySchema,
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: GetActivityBonusHistoryResponseSchema,
                },
            },
            description: "List of activity bonus records",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

export const activityBonusHistoryRoutes = (app: OpenAPIHono) => {
    app.openapi(getActivityBonusHistoryRoute, async (c) => {
        try {
            const { page, limit, userId, type, status } = c.req.valid("query");

            const skip = (page - 1) * limit;

            // Check cache using hash-based caching
            const mainCacheKey = CacheKey.adminActivityBonusHistory;
            const fieldKey = `userId:${userId || "all"}-type:${
                type || "all"
            }-status:${status || "all"}-page:${page}-limit:${limit}`;

            const cachedData = await Cache.hget<{
                activityBonuses: Array<{
                    id: string;
                    userId: string;
                    user: {
                        id: string;
                        serialNumber: number;
                        username: string;
                        mobileNumber: string;
                    };
                    type: ActivityBonusType;
                    status: ActivityBonusStatus;
                    amount: number;
                    metadata?: Record<string, any>;
                    expiresAt: string | null;
                    claimAt: string | null;
                    createdAt: string;
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

            const where: any = {};
            if (userId) {
                where.userId = userId;
            }
            if (type) {
                where.type = type;
            }
            if (status) {
                where.status = status;
            }

            const [activityBonuses, total] = await Promise.all([
                prisma.activityBonus.findMany({
                    where,
                    take: limit,
                    skip,
                    orderBy: {
                        createdAt: "desc",
                    },
                    include: {
                        user: {
                            select: {
                                id: true,
                                serialNumber: true,
                                username: true,
                                mobileNumber: true,
                            },
                        },
                    },
                }),
                prisma.activityBonus.count({ where }),
            ]);

            const totalPages = Math.ceil(total / limit);

            const result = {
                activityBonuses: activityBonuses.map((activityBonus) => ({
                    id: activityBonus.id,
                    userId: activityBonus.userId,
                    user: {
                        id: activityBonus.user.id,
                        serialNumber: activityBonus.user.serialNumber,
                        username: activityBonus.user.username,
                        mobileNumber: activityBonus.user.mobileNumber,
                    },
                    type: activityBonus.type,
                    status: activityBonus.status,
                    amount: activityBonus.amount,
                    metadata: activityBonus.metadata as
                        | Record<string, any>
                        | undefined,
                    expiresAt: activityBonus.expiresAt?.toISOString() ?? null,
                    claimAt: activityBonus.claimAt?.toISOString() ?? null,
                    createdAt: activityBonus.createdAt.toISOString(),
                })),
                total,
                currentPage: page,
                totalPages,
            };

            // Cache for 15 minutes
            await Cache.hset(mainCacheKey, fieldKey, result, 60 * 15);

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
};
