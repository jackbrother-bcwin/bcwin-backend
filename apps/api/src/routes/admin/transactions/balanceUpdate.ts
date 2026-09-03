import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie, limit, page } from "@/schemas";
import { prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import { adminUserSearchOr, normalizeAdminUserSearch } from "@/lib/adminUserSearch";
import {
    ADMIN_USER_IDENTITY_SELECT,
    mapAdminUserIdentity,
} from "@/lib/adminUserIdentity";

const logger = new Logger("admin-balance-transactions");

// List balance update transactions schema
const GetBalanceTransactionsQuerySchema = z.object({
    page,
    limit,
    search: z.string().optional().openapi({
        description:
            "Filter by UUID, mobile, username, or exact serial prefixed with #",
        example: "#10009",
    }),
});

const BalanceTransactionItemSchema = z.object({
    id: z.string().openapi({
        description: "Transaction ID",
        example: "uuid-123",
    }),
    amount: z.number().openapi({
        description: "Amount updated (positive or negative)",
        example: 100,
    }),
    reason: z.string().openapi({
        description: "Reason for balance update",
        example: "Bonus credit",
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
    by: z.object({
        id: z.string().openapi({
            description: "Admin ID who performed the action",
            example: "admin-123",
        }),
        serialNumber: z.number().openapi({
            description: "Admin serial number",
            example: 8400,
        }),
        username: z.string().openapi({
            description: "Admin username",
            example: "admin",
        }),
        role: z.string().openapi({
            description: "Admin role",
            example: "ADMIN",
        }),
    }),
    createdAt: z.string().openapi({
        description: "Transaction timestamp",
        example: "2025-01-12T10:30:00Z",
    }),
});

const GetBalanceTransactionsResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    transactions: z.array(BalanceTransactionItemSchema),
    total: z.number().openapi({
        description: "Total number of transactions",
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

const getBalanceTransactionsRoute = createRoute({
    method: "get",
    path: "/balance-update",
    tags: ["admin"],
    summary: "List balance update transactions",
    description:
        "Get a paginated list of admin balance update transactions. Filter users by any of: userId (UUID), serial number, username, or mobile number.",
    request: {
        query: GetBalanceTransactionsQuerySchema,
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: GetBalanceTransactionsResponseSchema,
                },
            },
            description: "List of balance update transactions",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

export const balanceTransactionRoutes = (app: OpenAPIHono) => {
    app.openapi(getBalanceTransactionsRoute, async (c) => {
        try {
            const { page, limit, search } = c.req.valid("query");
            const normalizedSearch = normalizeAdminUserSearch(search);

            const skip = (page - 1) * limit;

            // Check cache using hash-based caching
            const mainCacheKey = CacheKey.adminBalanceTransactions;
            const fieldKey = `v5-search:${
                normalizedSearch || "all"
            }-page:${page}-limit:${limit}`;

            const cachedData = await Cache.hget<{
                transactions: Array<{
                    id: string;
                    amount: number;
                    reason: string;
                    user: {
                        id: string;
                        serialNumber: number;
                        username: string;
                        mobileNumber: string;
                    };
                    by: {
                        id: string;
                        serialNumber: number;
                        username: string;
                        role: string;
                    };
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

            // Build a flexible user filter from the search term
            const where: any = {};
            if (normalizedSearch) {
                where.user = {
                    OR: adminUserSearchOr(normalizedSearch),
                };
            }

            const [transactions, total] = await Promise.all([
                prisma.adminBalanceUpdateTransaction.findMany({
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
                        by: {
                            select: {
                                id: true,
                                serialNumber: true,
                                username: true,
                                role: true,
                            },
                        },
                    },
                }),
                prisma.adminBalanceUpdateTransaction.count({ where }),
            ]);

            const totalPages = Math.ceil(total / limit);

            const result = {
                transactions: transactions.map((transaction) => ({
                    id: transaction.id,
                    amount: transaction.amount,
                    reason: transaction.reason,
                    user: mapAdminUserIdentity(transaction.user),
                    by: {
                        id: transaction.by.id,
                        serialNumber: transaction.by.serialNumber,
                        username: transaction.by.username,
                        role: transaction.by.role,
                    },
                    createdAt: transaction.createdAt.toISOString(),
                })),
                total,
                currentPage: page,
                totalPages,
            };

            // Cache for 5 hours
            await Cache.hset(mainCacheKey, fieldKey, result, 60 * 60 * 5);

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
