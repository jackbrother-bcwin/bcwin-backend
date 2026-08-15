import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie, limit, page } from "@/schemas";
import { prisma, QueryStatus, QueryType } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";

const logger = new Logger("admin-queries-list");

// List queries schema
const GetQueriesQuerySchema = z.object({
    page,
    limit,
    status: z.nativeEnum(QueryStatus).optional().openapi({
        description: "Filter queries by status",
        example: "CREATED",
    }),
    userId: z.string().optional().openapi({
        description: "Filter queries by user ID",
        example: "user-123",
    }),
    serialNumber: z.coerce.number().optional().openapi({
        description: "Filter queries by user serial number",
        example: 8400,
    }),
});

const QueryItemSchema = z.object({
    id: z.string().openapi({
        description: "Query ID",
        example: "uuid-123",
    }),
    ticketId: z.string().openapi({
        description: "Unique ticket ID",
        example: "TKT-20260124-123456",
    }),
    type: z.string().openapi({
        description: "Query type",
        example: "DEPOSIT",
    }),
    status: z.string().openapi({
        description: "Query status",
        example: "CREATED",
    }),
    subject: z.string().openapi({
        description: "Query subject",
        example: "Deposit not credited",
    }),
    details: z.any().openapi({
        description: "Query details",
        example: { amount: 1000, transactionId: "TXN123" },
    }),
    adminNotes: z.string().nullable().optional().openapi({
        description: "Admin notes",
        example: "Verified and processing",
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
    resolvedAt: z.string().nullable().optional().openapi({
        description: "Resolution timestamp",
        example: "2026-01-24T10:30:00Z",
    }),
    createdAt: z.string().openapi({
        description: "Creation timestamp",
        example: "2026-01-24T10:30:00Z",
    }),
    updatedAt: z.string().openapi({
        description: "Last update timestamp",
        example: "2026-01-24T10:30:00Z",
    }),
});

const GetQueriesResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    queries: z.array(QueryItemSchema),
    total: z.number().openapi({
        description: "Total number of queries",
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

const getQueriesRoute = createRoute({
    method: "get",
    path: "/",
    tags: ["admin"],
    summary: "List user queries",
    description:
        "Get a paginated list of user queries with optional status, userId, and serialNumber filtering",
    request: {
        query: GetQueriesQuerySchema,
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: GetQueriesResponseSchema,
                },
            },
            description: "List of user queries",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

export const listQueriesRoutes = (app: OpenAPIHono) => {
    app.openapi(getQueriesRoute, async (c) => {
        try {
            const { page, limit, status, userId, serialNumber } =
                c.req.valid("query");

            const skip = (page - 1) * limit;

            // Check cache using hash-based caching
            const mainCacheKey = CacheKey.adminQueries;
            const fieldKey = `status:${status || "all"}-userId:${userId || "all"
                }-serialNumber:${serialNumber || "all"}-page:${page}-limit:${limit}`;

            const cachedData = await Cache.hget<{
                queries: Array<{
                    id: string;
                    ticketId: string;
                    type: string;
                    status: string;
                    subject: string;
                    details: any;
                    adminNotes: string | null;
                    user: {
                        id: string;
                        serialNumber: number;
                        username: string;
                        mobileNumber: string;
                    };
                    resolvedAt: string | null;
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

            if (status) {
                where.status = status as QueryStatus;
            }

            if (userId) {
                where.userId = userId;
            }

            if (serialNumber) {
                where.user = {
                    serialNumber: serialNumber,
                };
            }

            const [queries, total] = await Promise.all([
                prisma.userQuery.findMany({
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
                prisma.userQuery.count({ where }),
            ]);

            const totalPages = Math.ceil(total / limit);

            const result = {
                queries: queries.map((query) => ({
                    id: query.id,
                    ticketId: query.ticketId,
                    type: query.type,
                    status: query.status,
                    subject: query.subject,
                    details: query.details,
                    adminNotes: query.adminNotes,
                    user: {
                        id: query.user.id,
                        serialNumber: query.user.serialNumber,
                        username: query.user.username,
                        mobileNumber: query.user.mobileNumber,
                    },
                    resolvedAt: query.resolvedAt?.toISOString() || null,
                    createdAt: query.createdAt.toISOString(),
                    updatedAt: query.updatedAt.toISOString(),
                })),
                total,
                currentPage: page,
                totalPages,
            };

            // Cache for 2 minutes
            await Cache.hset(mainCacheKey, fieldKey, result, 60 * 2);

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
