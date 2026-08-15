import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie, limit, page } from "@/schemas";
import {
    prisma,
    PaymentOrderStatus,
    WithdrawOrderStatus,
    Withdraw,
} from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import * as Config from "@bcwin/config";
import {
    isValidYmd,
    parseYmdEndInclusiveIst,
    parseYmdStartIst,
} from "@/lib/istDate";

const logger = new Logger("user-transaction");

function extractWithdrawTxHash(metadata: unknown): string | null {
    if (!metadata || typeof metadata !== "object") return null;
    const m = metadata as Record<string, unknown>;
    for (const key of ["tx_hash", "txHash", "txid", "hash"] as const) {
        const v = m[key];
        if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
}

function applyIstCreatedAtFilter(
    where: { createdAt?: { gte?: Date; lte?: Date } },
    startDate?: string,
    endDate?: string
): string | null {
    if (!startDate && !endDate) return null;
    if (startDate && !isValidYmd(startDate)) {
        return "Invalid startDate. Use YYYY-MM-DD";
    }
    if (endDate && !isValidYmd(endDate)) {
        return "Invalid endDate. Use YYYY-MM-DD";
    }
    where.createdAt = {};
    if (startDate) where.createdAt.gte = parseYmdStartIst(startDate);
    if (endDate) where.createdAt.lte = parseYmdEndInclusiveIst(endDate);
    return null;
}

// Deposit list schema
const GetDepositsQuerySchema = z.object({
    page,
    limit,
    status: z.enum(PaymentOrderStatus).optional().openapi({
        description: "Filter deposits by status",
        example: "SUCCESS",
    }),
    method: z.enum(Config.PAYMENT_METHODS).optional().openapi({
        description: "Filter deposits by payment method",
        example: "CXPAY",
    }),
    startDate: z.string().optional().openapi({
        description: "Start date in YYYY-MM-DD format",
        example: "2025-01-01",
    }),
    endDate: z.string().optional().openapi({
        description: "End date in YYYY-MM-DD format",
        example: "2025-01-31",
    }),
});

const DepositItemSchema = z.object({
    id: z.string().openapi({
        description: "Deposit ID",
        example: "uuid-123",
    }),
    orderId: z.string().openapi({
        description: "Deposit order ID",
        example: "20250112-12345678901234",
    }),
    amount: z.number().openapi({
        description: "Deposit amount in INR (wallet credit / order value)",
        example: 1000,
    }),
    usdtAmount: z
        .number()
        .nullable()
        .optional()
        .openapi({
            description:
                "USDT amount when method is OXAPAY; null for INR methods",
            example: 10,
        }),
    method: z.string().openapi({
        description: "Deposit method",
        example: "CXPAY",
    }),
    status: z.string().openapi({
        description: "Deposit status",
        example: "SUCCESS",
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

const GetDepositsResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    deposits: z.array(DepositItemSchema),
    total: z.number().openapi({
        description: "Total number of deposits",
        example: 50,
    }),
    currentPage: z.number().openapi({
        description: "Current page number",
        example: 1,
    }),
    totalPages: z.number().openapi({
        description: "Total number of pages",
        example: 2,
    }),
});

// Withdrawal list schema
const GetWithdrawalsQuerySchema = z.object({
    page,
    limit,
    status: z.enum(WithdrawOrderStatus).optional().openapi({
        description: "Filter withdrawals by status",
        example: "SUCCESS",
    }),
    method: z.enum(Config.WITHDRAW_METHODS).optional().openapi({
        description: "Filter withdrawals by payment method",
        example: "CXPAY",
    }),
    startDate: z.string().optional().openapi({
        description: "Start date in YYYY-MM-DD format",
        example: "2025-01-01",
    }),
    endDate: z.string().optional().openapi({
        description: "End date in YYYY-MM-DD format",
        example: "2025-01-31",
    }),
});

const WithdrawalItemSchema = z.object({
    id: z.string().openapi({
        description: "Withdrawal ID",
        example: "uuid-123",
    }),
    orderId: z.string().openapi({
        description: "Withdrawal order ID",
        example: "20250112-12345678901234",
    }),
    amount: z.number().openapi({
        description: "Withdrawal amount",
        example: 1000,
    }),
    method: z.string().openapi({
        description: "Withdrawal method",
        example: "CXPAY",
    }),
    cryptoChain: z
        .string()
        .nullable()
        .optional()
        .openapi({
            description: "USDT chain when method is OXAPAY (BEP20 or TRC20)",
            example: "BEP20",
        }),
    usdtAmount: z
        .number()
        .nullable()
        .optional()
        .openapi({
            description: "USDT size when method is OXAPAY",
            example: 10,
        }),
    txHash: z
        .string()
        .nullable()
        .optional()
        .openapi({
            description: "On-chain tx hash from OXAPAY payout callback, if any",
            example: "0xabc…",
        }),
    status: z.string().openapi({
        description: "Withdrawal status",
        example: "SUCCESS",
    }),
    note: z.string().optional().nullable().openapi({
        description: "Withdrawal note",
        example: "This is a note for the withdraw",
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

const GetWithdrawalsResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    withdrawals: z.array(WithdrawalItemSchema),
    total: z.number().openapi({
        description: "Total number of withdrawals",
        example: 30,
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

const getDepositsRoute = createRoute({
    method: "get",
    path: "/deposits",
    tags: ["user"],
    summary: "Get user deposits",
    description:
        "Get a paginated list of user's deposits with optional status, method, and date filtering",
    request: {
        query: GetDepositsQuerySchema,
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: GetDepositsResponseSchema,
                },
            },
            description: "List of user deposits",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

const getWithdrawalsRoute = createRoute({
    method: "get",
    path: "/withdrawals",
    tags: ["user"],
    summary: "Get user withdrawals",
    description:
        "Get a paginated list of user's withdrawals with optional status, method, and date filtering",
    request: {
        query: GetWithdrawalsQuerySchema,
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: GetWithdrawalsResponseSchema,
                },
            },
            description: "List of user withdrawals",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

export const transactionRoutes = (app: OpenAPIHono) => {
    app.openapi(getDepositsRoute, async (c) => {
        try {
            const user = c.get("user");
            const { page, limit, status, method, startDate, endDate } =
                c.req.valid("query");

            const skip = (page - 1) * limit;

            // NOTE: Do not cache deposit history.
            // Users must see freshly created PROCESSING orders immediately
            // (pay flow → history / 3rd-party recharge gate). Status flips
            // SUCCESS/FAILED also need to show without waiting on Redis TTL.

            // Build where clause
            const where: any = {
                userId: user.id,
            };

            if (status) {
                where.status = status as PaymentOrderStatus;
            }

            if (method) {
                where.method = method;
            }

            const dateErr = applyIstCreatedAtFilter(where, startDate, endDate);
            if (dateErr) {
                return apiError(c, dateErr, HTTP_STATUS.BAD_REQUEST);
            }

            const [deposits, total] = await Promise.all([
                prisma.deposit.findMany({
                    where,
                    take: limit,
                    skip,
                    orderBy: {
                        createdAt: "desc",
                    },
                }),
                prisma.deposit.count({ where }),
            ]);

            const totalPages = Math.ceil(total / limit) || 1;

            const result = {
                deposits: deposits.map((deposit) => ({
                    id: deposit.id,
                    orderId: deposit.orderId,
                    amount: deposit.amount,
                    usdtAmount:
                        deposit.usdtAmount != null
                            ? Number(deposit.usdtAmount)
                            : null,
                    method: deposit.method,
                    status: deposit.status,
                    createdAt:
                        deposit.createdAt instanceof Date
                            ? deposit.createdAt.toISOString()
                            : String(deposit.createdAt),
                    updatedAt:
                        deposit.updatedAt instanceof Date
                            ? deposit.updatedAt.toISOString()
                            : String(deposit.updatedAt),
                })),
                total,
                currentPage: page,
                totalPages,
            };

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

    app.openapi(getWithdrawalsRoute, async (c) => {
        try {
            const user = c.get("user");
            const { page, limit, status, method, startDate, endDate } =
                c.req.valid("query");

            const skip = (page - 1) * limit;

            // Check cache using hash-based caching
            const mainCacheKey = CacheKey.userWithdrawals(user.id);
            const fieldKey = `v2-status:${status || "all"}-method:${
                method || "all"
            }-start:${startDate || "none"}-end:${
                endDate || "none"
            }-page:${page}-limit:${limit}`;

            const cachedData = await Cache.hget<{
                withdrawals: Array<Withdraw>;
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
                where.status = status as WithdrawOrderStatus;
            }

            if (method) {
                where.method = method;
            }

            const dateErr = applyIstCreatedAtFilter(where, startDate, endDate);
            if (dateErr) {
                return apiError(c, dateErr, HTTP_STATUS.BAD_REQUEST);
            }

            const [withdrawals, total] = await Promise.all([
                prisma.withdraw.findMany({
                    where,
                    take: limit,
                    skip,
                    orderBy: {
                        createdAt: "desc",
                    },
                }),
                prisma.withdraw.count({ where }),
            ]);

            const totalPages = Math.ceil(total / limit);

            const result = {
                withdrawals: withdrawals.map((withdrawal) => ({
                    id: withdrawal.id,
                    orderId: withdrawal.orderId,
                    amount: withdrawal.amount,
                    method: withdrawal.method,
                    cryptoChain: withdrawal.cryptoChain ?? null,
                    usdtAmount:
                        withdrawal.usdtAmount != null
                            ? Number(withdrawal.usdtAmount)
                            : null,
                    txHash: extractWithdrawTxHash(withdrawal.metadata),
                    status: withdrawal.status,
                    note: withdrawal.note,
                    createdAt:
                        withdrawal.createdAt instanceof Date
                            ? withdrawal.createdAt.toISOString()
                            : String(withdrawal.createdAt),
                    updatedAt:
                        withdrawal.updatedAt instanceof Date
                            ? withdrawal.updatedAt.toISOString()
                            : String(withdrawal.updatedAt),
                })),
                total,
                currentPage: page,
                totalPages,
            };

            // Short TTL; place/cancel also invalidate userWithdrawals
            await Cache.hset(mainCacheKey, fieldKey, result, 30);

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
