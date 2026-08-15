import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie, limit, page } from "@/schemas";
import { prisma, PaymentOrderStatus } from "@bcwin/db";
import { WebSocketManager } from "@bcwin/websocket";
import { Cache, CacheKey } from "@bcwin/cache";
import {
    checkAndCreateFirstDepositBonus,
    checkAndCreateDailyBonuses,
    creditRechargeBonus,
} from "@bcwin/activity-bonus";
import * as Config from "@bcwin/config";
import { createWagerRequirement } from "@/lib/wagerEngine";

const logger = new Logger("admin-deposit");

// List deposits schema
const GetDepositsQuerySchema = z.object({
    page,
    limit,
    status: z.enum(PaymentOrderStatus).optional().openapi({
        description: "Filter deposits by status",
        example: "PROCESSING",
    }),
    method: z.string().optional().openapi({
        description: "Filter deposits by payment method",
        example: "UPI",
    }),
    userId: z.string().optional().openapi({
        description: "Filter deposits by user ID",
        example: "user-123",
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
        description: "Deposit amount",
        example: 1000,
    }),
    method: z.string().openapi({
        description: "Deposit method",
        example: "UPI",
    }),
    status: z.string().openapi({
        description: "Deposit status",
        example: "PROCESSING",
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

// Manage deposit schema
const ManageDepositBodySchema = z.object({
    action: z.enum(["approve", "reject"]).openapi({
        description: "Action to perform on the deposit",
        example: "approve",
    }),
    orderId: z.string().openapi({
        description: "Order ID of the deposit to manage",
        example: "20250112-12345678901234",
    }),
});

const ManageDepositResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the action was successful",
        example: true,
    }),
    message: z.string().openapi({
        description: "Result message",
        example: "Deposit approved successfully",
    }),
});

const getDepositsRoute = createRoute({
    method: "get",
    path: "/deposit",
    tags: ["admin"],
    summary: "List deposits",
    description:
        "Get a paginated list of deposits with optional status, method, and userId filtering",
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
            description: "List of deposits",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

const manageDepositRoute = createRoute({
    method: "post",
    path: "/deposit/manage",
    tags: ["admin"],
    summary: "Manage deposit",
    description:
        "Approve or reject a UPI deposit request. Approving will credit the amount to user's balance and mark as SUCCESS. Rejecting will mark as FAILED.",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: ManageDepositBodySchema,
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: ManageDepositResponseSchema,
                },
            },
            description: "Deposit managed successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

export const depositRoutes = (app: OpenAPIHono) => {
    app.openapi(getDepositsRoute, async (c) => {
        try {
            const { page, limit, status, method, userId } =
                c.req.valid("query");

            const skip = (page - 1) * limit;

            // Check cache using hash-based caching
            const mainCacheKey = CacheKey.adminDeposits;
            const fieldKey = `status:${status || "all"}-method:${
                method || "all"
            }-userId:${userId || "all"}-page:${page}-limit:${limit}`;

            const cachedData = await Cache.hget<{
                deposits: Array<{
                    id: string;
                    orderId: string;
                    amount: number;
                    method: string;
                    status: string;
                    user: {
                        id: string;
                        serialNumber: number;
                        username: string;
                        mobileNumber: string;
                    };
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
                where.status = status as PaymentOrderStatus;
            }
            if (method) {
                where.method = method;
            }
            if (userId) {
                where.userId = userId;
            }

            const [deposits, total] = await Promise.all([
                prisma.deposit.findMany({
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
                prisma.deposit.count({ where }),
            ]);

            const totalPages = Math.ceil(total / limit);

            const result = {
                deposits: deposits.map((deposit) => ({
                    id: deposit.id,
                    orderId: deposit.orderId,
                    amount: deposit.amount,
                    method: deposit.method,
                    status: deposit.status,
                    user: {
                        id: deposit.user.id,
                        serialNumber: deposit.user.serialNumber,
                        username: deposit.user.username,
                        mobileNumber: deposit.user.mobileNumber,
                    },
                    createdAt: deposit.createdAt.toISOString(),
                    updatedAt: deposit.updatedAt.toISOString(),
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

    app.openapi(manageDepositRoute, async (c) => {
        try {
            const { action, orderId } = c.req.valid("json");

            // Find the deposit with PROCESSING status
            const deposit = await prisma.deposit.findUnique({
                where: {
                    orderId,
                },
                include: {
                    user: true,
                },
            });

            if (!deposit) {
                return apiError(
                    c,
                    "Deposit not found with provided orderId",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            if (deposit.status !== PaymentOrderStatus.PROCESSING) {
                return apiError(
                    c,
                    `Deposit is in ${deposit.status} state. Can only manage deposits in PROCESSING state`,
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            // Only allow managing UPI deposits
            if (deposit.method !== "UPI") {
                return apiError(
                    c,
                    `Only UPI deposits can be manually managed. This deposit uses ${deposit.method} method`,
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            // Handle reject action
            if (action === "reject") {
                await prisma.deposit.update({
                    where: {
                        orderId,
                    },
                    data: {
                        status: PaymentOrderStatus.FAILED,
                    },
                });

                // Invalidate deposit cache
                await Cache.del(CacheKey.adminDeposits);

                return c.json(
                    {
                        success: true,
                        message: "Deposit rejected successfully",
                    },
                    HTTP_STATUS.OK
                );
            }

            // Handle approve action
            const principalInr = Number(deposit.amount) || 0;
            const inrBonusPct =
                await Config.SystemSettings.getInrDepositBonusPercent();

            const { updatedUser, depositId } = await prisma.$transaction(
                async (tx) => {
                    const dep = await tx.deposit.update({
                        where: {
                            orderId,
                        },
                        data: {
                            status: PaymentOrderStatus.SUCCESS,
                            amount: principalInr,
                        },
                    });

                    const updatedUser = await tx.user.update({
                        where: {
                            id: deposit.userId,
                        },
                        data: {
                            balance: {
                                increment: principalInr,
                            },
                        },
                        select: {
                            balance: true,
                        },
                    });

                    await createWagerRequirement(tx, deposit.userId, "RECHARGE", principalInr, dep.id);

                    return { updatedUser, depositId: dep.id };
                }
            );

            const { bonus } = await creditRechargeBonus({
                userId: deposit.userId,
                principalInr,
                percent: inrBonusPct,
                channel: "INR",
                depositId,
                orderId,
                method: "UPI",
            });

            WebSocketManager.publishToUser(deposit.userId, "account-balance", {
                balance: updatedUser.balance + (bonus > 0 ? bonus : 0),
            });

            // Fire-and-forget: Check first deposit and daily bonuses
            checkAndCreateFirstDepositBonus(deposit.userId, principalInr);
            checkAndCreateDailyBonuses(deposit.userId);

            // Invalidate deposit cache
            await Cache.del(CacheKey.adminDeposits);

            return c.json(
                {
                    success: true,
                    message:
                        "Deposit approved and balance credited successfully",
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
