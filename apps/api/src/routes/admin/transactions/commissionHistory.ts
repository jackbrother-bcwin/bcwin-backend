import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie, limit, page } from "@/schemas";
import { prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";

const logger = new Logger("admin-commission-history");

// Query schema
const GetCommissionHistoryQuerySchema = z.object({
    page,
    limit,
    userId: z.string().optional().openapi({
        description: "Filter by user ID (who received the commission)",
        example: "user-123",
    }),
    fromUserId: z.string().optional().openapi({
        description: "Filter by from user ID (who generated the commission)",
        example: "user-456",
    }),
    layer: z.coerce.number().int().min(1).max(6).optional().openapi({
        description: "Filter by commission layer (1-6)",
        example: 1,
    }),
    betType: z.string().optional().openapi({
        description: "Filter by bet type (WINGO, 5D, K3, MOTO)",
        example: "WINGO",
    }),
});

// Commission item schema
const CommissionItemSchema = z.object({
    id: z.string().openapi({
        description: "Commission ID",
        example: "uuid-123",
    }),
    userId: z.string().openapi({
        description: "User ID who received the commission",
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
    fromUserId: z.string().openapi({
        description: "User ID who generated the commission",
        example: "user-456",
    }),
    fromUser: z.object({
        id: z.string().openapi({
            description: "From user ID",
            example: "user-456",
        }),
        serialNumber: z.number().openapi({
            description: "From user serial number",
            example: 8401,
        }),
        username: z.string().openapi({
            description: "From username",
            example: "user456",
        }),
        mobileNumber: z.string().openapi({
            description: "From user mobile number",
            example: "9876543211",
        }),
    }),
    layer: z.number().openapi({
        description: "Commission layer (1-6)",
        example: 1,
    }),
    userVipLevel: z.number().openapi({
        description: "VIP level at time of commission",
        example: 3,
    }),
    commissionRate: z.number().openapi({
        description: "Commission rate percentage",
        example: 0.5,
    }),
    betAmount: z.number().openapi({
        description: "Original bet amount",
        example: 1000,
    }),
    commissionAmount: z.number().openapi({
        description: "Calculated commission amount",
        example: 5,
    }),
    betType: z.string().openapi({
        description: "Bet type",
        example: "WINGO",
    }),
    betId: z.string().openapi({
        description: "Bet ID",
        example: "bet-123",
    }),
    calculationDate: z.string().openapi({
        description: "Calculation date",
        example: "2025-01-12T00:00:00Z",
    }),
    createdAt: z.string().openapi({
        description: "Creation timestamp",
        example: "2025-01-12T10:30:00Z",
    }),
});

// Response schema
const GetCommissionHistoryResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    commissions: z.array(CommissionItemSchema),
    total: z.number().openapi({
        description: "Total number of commissions",
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

const getCommissionHistoryRoute = createRoute({
    method: "get",
    path: "/commission-history",
    tags: ["admin"],
    summary: "List commission history",
    description:
        "Get a paginated list of all commission records with optional filtering by userId, fromUserId, layer, and betType",
    request: {
        query: GetCommissionHistoryQuerySchema,
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: GetCommissionHistoryResponseSchema,
                },
            },
            description: "List of commission records",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

export const commissionHistoryRoutes = (app: OpenAPIHono) => {
    app.openapi(getCommissionHistoryRoute, async (c) => {
        try {
            const { page, limit, userId, fromUserId, layer, betType } =
                c.req.valid("query");

            const skip = (page - 1) * limit;

            // Check cache using hash-based caching
            const mainCacheKey = CacheKey.adminCommissionHistory;
            const fieldKey = `userId:${userId || "all"}-fromUserId:${
                fromUserId || "all"
            }-layer:${layer || "all"}-betType:${
                betType || "all"
            }-page:${page}-limit:${limit}`;

            const cachedData = await Cache.hget<{
                commissions: Array<{
                    id: string;
                    userId: string;
                    user: {
                        id: string;
                        serialNumber: number;
                        username: string;
                        mobileNumber: string;
                    };
                    fromUserId: string;
                    fromUser: {
                        id: string;
                        serialNumber: number;
                        username: string;
                        mobileNumber: string;
                    };
                    layer: number;
                    userVipLevel: number;
                    commissionRate: number;
                    betAmount: number;
                    commissionAmount: number;
                    betType: string;
                    betId: string;
                    calculationDate: string;
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
            if (fromUserId) {
                where.fromUserId = fromUserId;
            }
            if (layer) {
                where.layer = layer;
            }
            if (betType) {
                where.betType = betType;
            }

            const [commissions, total] = await Promise.all([
                prisma.commission.findMany({
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
                        fromUser: {
                            select: {
                                id: true,
                                serialNumber: true,
                                username: true,
                                mobileNumber: true,
                            },
                        },
                    },
                }),
                prisma.commission.count({ where }),
            ]);

            const totalPages = Math.ceil(total / limit);

            const result = {
                commissions: commissions.map((commission) => ({
                    id: commission.id,
                    userId: commission.userId,
                    user: {
                        id: commission.user.id,
                        serialNumber: commission.user.serialNumber,
                        username: commission.user.username,
                        mobileNumber: commission.user.mobileNumber,
                    },
                    fromUserId: commission.fromUserId,
                    fromUser: {
                        id: commission.fromUser.id,
                        serialNumber: commission.fromUser.serialNumber,
                        username: commission.fromUser.username,
                        mobileNumber: commission.fromUser.mobileNumber,
                    },
                    layer: commission.layer,
                    userVipLevel: commission.userVipLevel,
                    commissionRate: commission.commissionRate,
                    betAmount: commission.betAmount,
                    commissionAmount: commission.commissionAmount,
                    betType: commission.betType,
                    betId: commission.betId,
                    calculationDate: commission.calculationDate.toISOString(),
                    createdAt: commission.createdAt.toISOString(),
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
