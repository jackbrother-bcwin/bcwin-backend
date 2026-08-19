import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie, limit, page } from "@/schemas";
import { prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import {
    ADMIN_USER_IDENTITY_SELECT,
    mapAdminUserIdentity,
} from "@/lib/adminUserIdentity";

const logger = new Logger("admin-rebate-history");

// Query schema
const GetRebateHistoryQuerySchema = z.object({
    page,
    limit,
    userId: z.string().optional().openapi({
        description: "Filter by user ID",
        example: "user-123",
    }),
    game: z.string().optional().openapi({
        description: "Filter by game name",
        example: "WINGO",
    }),
    settled: z
        .enum(["true", "false", "all"])
        .optional()
        .default("all")
        .openapi({
            description: "Filter by settled status",
            example: "true",
        }),
});

// Rebate item schema
const RebateItemSchema = z.object({
    id: z.string().openapi({
        description: "Rebate ID",
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
        email: z.string().nullable().optional(),
        bank: z
            .object({ fullName: z.string().nullable() })
            .nullable()
            .optional(),
    }),
    amount: z.number().openapi({
        description: "Rebate amount",
        example: 5,
    }),
    game: z.string().openapi({
        description: "Game name",
        example: "WINGO",
    }),
    settled: z.boolean().openapi({
        description: "Whether the rebate is settled",
        example: true,
    }),
    createdAt: z.string().openapi({
        description: "Creation timestamp",
        example: "2025-01-12T10:30:00Z",
    }),
    updatedAt: z.string().openapi({
        description: "Last update timestamp",
        example: "2025-01-12T10:30:00Z",
    }),
});

// Response schema
const GetRebateHistoryResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    rebates: z.array(RebateItemSchema),
    total: z.number().openapi({
        description: "Total number of rebates",
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

const getRebateHistoryRoute = createRoute({
    method: "get",
    path: "/rebate-history",
    tags: ["admin"],
    summary: "List rebate history",
    description:
        "Get a paginated list of all rebate records with optional filtering by userId, game, and settled status",
    request: {
        query: GetRebateHistoryQuerySchema,
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: GetRebateHistoryResponseSchema,
                },
            },
            description: "List of rebate records",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

export const rebateHistoryRoutes = (app: OpenAPIHono) => {
    app.openapi(getRebateHistoryRoute, async (c) => {
        try {
            const { page, limit, userId, game, settled } = c.req.valid("query");

            const skip = (page - 1) * limit;

            // Check cache using hash-based caching
            const mainCacheKey = CacheKey.adminRebateHistory;
            const fieldKey = `v3-userId:${userId || "all"}-game:${
                game || "all"
            }-settled:${settled || "all"}-page:${page}-limit:${limit}`;

            const cachedData = await Cache.hget<{
                rebates: Array<{
                    id: string;
                    userId: string;
                    user: {
                        id: string;
                        serialNumber: number;
                        username: string;
                        mobileNumber: string;
                    };
                    amount: number;
                    game: string;
                    settled: boolean;
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

            const where: any = {};
            if (userId) {
                where.userId = userId;
            }
            if (game) {
                where.game = game;
            }
            if (settled && settled !== "all") {
                where.settled = settled === "true";
            }

            const [rebates, total] = await Promise.all([
                prisma.rebate.findMany({
                    where,
                    take: limit,
                    skip,
                    orderBy: {
                        createdAt: "desc",
                    },
                    include: {
                        user: {
                            select: ADMIN_USER_IDENTITY_SELECT,
                        },
                    },
                }),
                prisma.rebate.count({ where }),
            ]);

            const totalPages = Math.ceil(total / limit);

            const result = {
                rebates: rebates.map((rebate) => ({
                    id: rebate.id,
                    userId: rebate.userId,
                    user: mapAdminUserIdentity(rebate.user),
                    amount: rebate.amount,
                    game: rebate.game,
                    settled: rebate.settled,
                    createdAt: rebate.createdAt.toISOString(),
                    updatedAt: rebate.updatedAt.toISOString(),
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
