import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie, limit, page } from "@/schemas";
import { prisma, QueryStatus, QueryType } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";

const logger = new Logger("user-queries");

// Submit query schema
const SubmitQueryBodySchema = z.object({
    type: z.nativeEnum(QueryType).openapi({
        description: "Query type",
        example: "DEPOSIT",
    }),
    subject: z.string().min(5).max(200).openapi({
        description: "Query subject (5-200 characters)",
        example: "Deposit not credited to account",
    }),
    details: z.record(z.string(), z.any()).openapi({
        description: "Query details as key-value pairs",
        example: {
            amount: 1000,
            transactionId: "TXN123456",
            paymentMethod: "UPI",
            description: "Paid via UPI but amount not reflected in balance",
        },
    }),
});

const SubmitQueryResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the query was submitted successfully",
        example: true,
    }),
    message: z.string().openapi({
        description: "Result message",
        example: "Query submitted successfully",
    }),
    query: z.object({
        id: z.string(),
        ticketId: z.string(),
        type: z.string(),
        status: z.string(),
        subject: z.string(),
        createdAt: z.string(),
    }),
});

// Get user queries schema
const GetUserQueriesQuerySchema = z.object({
    page,
    limit,
    status: z.nativeEnum(QueryStatus).optional().openapi({
        description: "Filter queries by status",
        example: "CREATED",
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
        description: "Admin notes (if any)",
        example: null,
    }),
    resolvedAt: z.string().nullable().optional().openapi({
        description: "Resolution timestamp",
        example: null,
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

const GetUserQueriesResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    queries: z.array(QueryItemSchema),
    total: z.number().openapi({
        description: "Total number of user's queries",
        example: 5,
    }),
    currentPage: z.number().openapi({
        description: "Current page number",
        example: 1,
    }),
    totalPages: z.number().openapi({
        description: "Total number of pages",
        example: 1,
    }),
});

const submitQueryRoute = createRoute({
    method: "post",
    path: "/queries",
    tags: ["user"],
    summary: "Submit a query",
    description:
        "Submit a new customer support query. A unique ticket ID will be generated for tracking.",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: SubmitQueryBodySchema,
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: SubmitQueryResponseSchema,
                },
            },
            description: "Query submitted successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

const getUserQueriesRoute = createRoute({
    method: "get",
    path: "/queries",
    tags: ["user"],
    summary: "Get user's queries",
    description:
        "Get a paginated list of the authenticated user's queries with optional status filtering",
    request: {
        query: GetUserQueriesQuerySchema,
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: GetUserQueriesResponseSchema,
                },
            },
            description: "List of user's queries",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

export const userQueriesRoutes = (app: OpenAPIHono) => {
    app.openapi(submitQueryRoute, async (c) => {
        try {
            const user = c.get("user");
            const { type, subject, details } = c.req.valid("json");

            // Generate unique ticket ID
            const timestamp = Date.now();
            const random = Math.floor(Math.random() * 1000000)
                .toString()
                .padStart(6, "0");
            const ticketId = `TKT-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${random}${timestamp.toString().slice(-6)}`;

            // Create the query
            const query = await prisma.userQuery.create({
                data: {
                    ticketId,
                    userId: user.id,
                    type,
                    subject,
                    details: details as any,
                    status: QueryStatus.CREATED,
                },
            });

            // Invalidate user's query cache
            await Cache.del(CacheKey.userQueries(user.id));

            return c.json(
                {
                    success: true,
                    message: "Query submitted successfully",
                    query: {
                        id: query.id,
                        ticketId: query.ticketId,
                        type: query.type,
                        status: query.status,
                        subject: query.subject,
                        createdAt: query.createdAt.toISOString(),
                    },
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

    app.openapi(getUserQueriesRoute, async (c) => {
        try {
            const user = c.get("user");
            const { page, limit, status } = c.req.valid("query");

            const skip = (page - 1) * limit;

            // Check cache using hash-based caching
            const mainCacheKey = CacheKey.userQueries(user.id);
            const fieldKey = `status:${status || "all"}-page:${page}-limit:${limit}`;

            const cachedData = await Cache.hget<{
                queries: Array<{
                    id: string;
                    ticketId: string;
                    type: string;
                    status: string;
                    subject: string;
                    details: any;
                    adminNotes: string | null;
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

            // Build where clause
            const where: any = {
                userId: user.id,
            };

            if (status) {
                where.status = status as QueryStatus;
            }

            const [queries, total] = await Promise.all([
                prisma.userQuery.findMany({
                    where,
                    take: limit,
                    skip,
                    orderBy: {
                        createdAt: "desc",
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
                    resolvedAt: query.resolvedAt?.toISOString() || null,
                    createdAt: query.createdAt.toISOString(),
                    updatedAt: query.updatedAt.toISOString(),
                })),
                total,
                currentPage: page,
                totalPages,
            };

            // Cache for 20 minutes
            await Cache.hset(mainCacheKey, fieldKey, result, 60 * 20);

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
