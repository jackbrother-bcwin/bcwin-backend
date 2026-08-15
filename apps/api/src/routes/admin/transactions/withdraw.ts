import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import * as Config from "@bcwin/config";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie, limit, page } from "@/schemas";
import { prisma, WithdrawOrderStatus } from "@bcwin/db";
import { Cxpay, Xdpay, Oxapay, OxapayServiceUnavailableError, CxpayServiceUnavailableError, XdpayServiceUnavailableError } from "@/lib/payment";
import { WebSocketManager } from "@bcwin/websocket";
import { Cache, CacheKey } from "@bcwin/cache";

const logger = new Logger("admin-withdraw");

// List withdrawals schema
const GetWithdrawalsQuerySchema = z.object({
    page,
    limit,
    status: z.enum(WithdrawOrderStatus).optional().openapi({
        description: "Filter withdrawals by status",
        example: "GENERATED",
    }),
    userId: z.string().optional().openapi({
        description: "Filter withdrawals by user ID",
        example: "user-123",
    }),
    method: z.enum(Config.WITHDRAW_METHODS).optional().openapi({
        description: "Filter withdrawals by method",
        example: "CXPAY",
    }),
});

const WithdrawItemSchema = z.object({
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
    status: z.string().openapi({
        description: "Withdrawal status",
        example: "GENERATED",
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
    bank: z
        .object({
            fullName: z.string().nullable().openapi({
                description: "Account holder full name",
                example: "John Doe",
            }),
            bankAccount: z.string().nullable().openapi({
                description: "Bank account number",
                example: "1234567890",
            }),
            ifsc: z.string().nullable().openapi({
                description: "Bank IFSC code",
                example: "SBIN0001234",
            }),
        })
        .nullable()
        .openapi({
            description: "User bank details",
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
    withdrawals: z.array(WithdrawItemSchema),
    total: z.number().openapi({
        description: "Total number of withdrawals",
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

// Manage withdrawal schema
const ManageWithdrawalBodySchema = z.object({
    action: z.enum(["approve", "reject"]).openapi({
        description: "Action to perform on the withdrawal",
        example: "approve",
    }),
    orderId: z.string().openapi({
        description: "Order ID of the withdrawal to manage",
        example: "20250112-12345678901234",
    }),
});

const ManageWithdrawalResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the action was successful",
        example: true,
    }),
    message: z.string().openapi({
        description: "Result message",
        example: "Withdrawal approved successfully",
    }),
});

const getWithdrawalsRoute = createRoute({
    method: "get",
    path: "/withdraw",
    tags: ["admin"],
    summary: "List withdrawals",
    description:
        "Get a paginated list of withdrawals with optional status, userId, and method filtering",
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
            description: "List of withdrawals",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

const manageWithdrawalRoute = createRoute({
    method: "post",
    path: "/withdraw/manage",
    tags: ["admin"],
    summary: "Manage withdrawal",
    description:
        "Approve or reject a withdrawal request. If User have applied for withdraw with UPI method, it will be completed successfully, So please make sure payment is done before accepting the withdrawal.",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: ManageWithdrawalBodySchema,
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: ManageWithdrawalResponseSchema,
                },
            },
            description: "Withdrawal managed successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.serviceUnavailable(),
        ...CommonResponses.internalServerError(),
    },
});

type WithdrawMethod = (typeof Config.WITHDRAW_METHODS)[number];

export const withdrawRoutes = (app: OpenAPIHono) => {
    app.openapi(getWithdrawalsRoute, async (c) => {
        try {
            const { page, limit, status, userId, method } =
                c.req.valid("query");

            const skip = (page - 1) * limit;

            // Check cache using hash-based caching
            const mainCacheKey = CacheKey.adminWithdrawals;
            const fieldKey = `status:${status || "all"}-userId:${userId || "all"
                }-method:${method || "all"}-page:${page}-limit:${limit}`;

            const cachedData = await Cache.hget<{
                withdrawals: Array<{
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
                    bank: {
                        fullName: string;
                        bankAccount: string;
                        ifsc: string;
                    } | null;
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
                where.status = status as WithdrawOrderStatus;
            }
            if (userId) {
                where.userId = userId;
            }
            if (method) {
                where.method = method;
            }

            const [withdrawals, total] = await Promise.all([
                prisma.withdraw.findMany({
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
                                bank: {
                                    select: {
                                        fullName: true,
                                        bankAccount: true,
                                        ifsc: true,
                                    },
                                },
                            },
                        },
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
                    status: withdrawal.status,
                    user: {
                        id: withdrawal.user.id,
                        serialNumber: withdrawal.user.serialNumber,
                        username: withdrawal.user.username,
                        mobileNumber: withdrawal.user.mobileNumber,
                    },
                    bank: withdrawal.user.bank,
                    createdAt: withdrawal.createdAt.toISOString(),
                    updatedAt: withdrawal.updatedAt.toISOString(),
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

    app.openapi(manageWithdrawalRoute, async (c) => {
        try {
            const { action, orderId } = c.req.valid("json");

            // Find the withdrawal with GENERATED status
            const withdraw = await prisma.withdraw.findUnique({
                where: {
                    orderId,
                    status: WithdrawOrderStatus.GENERATED,
                },
                include: {
                    user: {
                        include: {
                            bank: true,
                        },
                    },
                },
            });

            if (!withdraw) {
                return apiError(
                    c,
                    "No withdrawal found in GENERATED state with provided orderId",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            // Handle reject action
            if (action === "reject") {
                const { updatedUser } = await prisma.$transaction(
                    async (tx) => {
                        // Update withdrawal status to FAILED
                        await tx.withdraw.update({
                            where: {
                                orderId,
                            },
                            data: {
                                status: WithdrawOrderStatus.FAILED,
                            },
                        });

                        // Refund the amount to user's balance
                        const updatedUser = await tx.user.update({
                            where: {
                                id: withdraw.userId,
                            },
                            data: {
                                balance: {
                                    increment: withdraw.amount,
                                },
                            },
                            select: {
                                balance: true,
                            },
                        });

                        return { updatedUser };
                    }
                );

                WebSocketManager.publishToUser(
                    withdraw.userId,
                    "account-balance",
                    {
                        balance: updatedUser.balance,
                    }
                );

                // Invalidate withdrawal cache
                await Cache.del(CacheKey.adminWithdrawals);

                return c.json(
                    {
                        success: true,
                        message: "Withdrawal rejected and amount refunded",
                    },
                    HTTP_STATUS.OK
                );
            }

            // Handle approve action

            if (!Config.WITHDRAW_METHODS.includes(withdraw.method as any)) {
                return apiError(
                    c,
                    `User has Withdrawal method '${withdraw.method
                    }' that is not supported. Valid methods are: ${Config.PAYMENT_METHODS.join(
                        ", "
                    )}`,
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            const withdrawMethod = withdraw.method as WithdrawMethod;

            if (withdrawMethod === "UPI") {
                await prisma.withdraw.update({
                    where: {
                        orderId,
                    },
                    data: {
                        status: WithdrawOrderStatus.SUCCESS,
                    },
                });

                // Invalidate withdrawal cache
                await Cache.del(CacheKey.adminWithdrawals);

                return c.json(
                    {
                        success: true,
                        message:
                            "Withdrawal approved and completed successfully",
                    },
                    HTTP_STATUS.OK
                );
            }

            // Check the withdraw method and initiate accordingly
            if (withdraw.method === "CXPAY") {
                const userBank = withdraw.user.bank;

                if (
                    !userBank ||
                    !userBank.bankAccount ||
                    !userBank.fullName ||
                    !userBank.ifsc
                ) {
                    return apiError(
                        c,
                        "Essential user bank details like bank account, full name and IFSC code are required for CXPAY withdrawal",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }

                const cxpayResp = await Cxpay.initiateWithdrawl(
                    withdraw.amount,
                    userBank.bankAccount,
                    userBank.fullName,
                    userBank.ifsc,
                    orderId
                );

                if (cxpayResp.code !== 200 || !cxpayResp.success) {
                    logger.error("[ADMIN_WITHDRAW_CXPAY]", cxpayResp);

                    return apiError(
                        c,
                        `Unable to initiate withdrawal at the moment. ${cxpayResp.msg || ""
                        }`,
                        HTTP_STATUS.SERVICE_UNAVAILABLE
                    );
                }

                // Update withdrawal status to PROCESSING
                await prisma.withdraw.update({
                    where: {
                        orderId,
                    },
                    data: {
                        status: WithdrawOrderStatus.PROCESSING,
                    },
                });

                // Invalidate withdrawal cache
                await Cache.del(CacheKey.adminWithdrawals);

                return c.json(
                    {
                        success: true,
                        message:
                            "Withdrawal approved and initiated successfully",
                    },
                    HTTP_STATUS.OK
                );
            }

            if (withdraw.method === "XDPAY") {
                const userBank = withdraw.user.bank;

                if (
                    !userBank ||
                    !userBank.bankAccount ||
                    !userBank.fullName ||
                    !userBank.ifsc
                ) {
                    return apiError(
                        c,
                        "Essential user bank details like bank account, full name and IFSC code are required for XDPAY withdrawal",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }

                const xdpayResp = await Xdpay.initiateWithdrawl(
                    withdraw.amount.toString(),
                    userBank.bankAccount,
                    userBank.fullName,
                    userBank.ifsc,
                    orderId
                );

                if (xdpayResp.code !== 200 || !xdpayResp.success) {
                    logger.error("[ADMIN_WITHDRAW_XDPAY]", xdpayResp);

                    return apiError(
                        c,
                        `Unable to initiate withdrawal at the moment. ${xdpayResp.msg || ""
                        }`,
                        HTTP_STATUS.SERVICE_UNAVAILABLE
                    );
                }

                // Update withdrawal status to PROCESSING
                await prisma.withdraw.update({
                    where: {
                        orderId,
                    },
                    data: {
                        status: WithdrawOrderStatus.PROCESSING,
                    },
                });

                // Invalidate withdrawal cache
                await Cache.del(CacheKey.adminWithdrawals);

                return c.json(
                    {
                        success: true,
                        message:
                            "Withdrawal approved and initiated successfully",
                    },
                    HTTP_STATUS.OK
                );
            }

            if (withdraw.method === "OXAPAY") {
                const userBank = withdraw.user.bank;
                const cryptoChain = withdraw.cryptoChain || "TRC20";
                const cryptoAddress = cryptoChain === "BEP20" ? userBank?.bep20Address : userBank?.trc20Address;

                if (!userBank || !cryptoAddress) {
                    return apiError(
                        c,
                        `${cryptoChain} wallet address is required for OXAPAY withdrawal`,
                        HTTP_STATUS.BAD_REQUEST
                    );
                }

                const config = await Config.SystemSettings.get();
                const rate = config?.inrToUsdtWithdrawalConversionRate!;

                const usdtAmount = withdraw.amount / rate;
                const amountToSend = usdtAmount;

                // description must be bare orderId — payout IPN has no order_id field
                const oxapayResp = await Oxapay.initiateWithdrawl(
                    amountToSend,
                    cryptoAddress,
                    "USDT",
                    cryptoChain,
                    orderId
                );

                if (oxapayResp.status !== 200) {
                    logger.error("[ADMIN_WITHDRAW_OXAPAY]", oxapayResp);

                    return apiError(
                        c,
                        `Unable to initiate withdrawal at the moment. ${oxapayResp.message || ""
                        }`,
                        HTTP_STATUS.SERVICE_UNAVAILABLE
                    );
                }

                // Update withdrawal status to PROCESSING
                await prisma.withdraw.update({
                    where: {
                        orderId,
                    },
                    data: {
                        status: WithdrawOrderStatus.PROCESSING,
                        usdtAmount: usdtAmount,
                    },
                });

                // Invalidate withdrawal cache
                await Cache.del(CacheKey.adminWithdrawals);

                return c.json(
                    {
                        success: true,
                        message: "Withdrawal approved and initiated successfully",
                    },
                    HTTP_STATUS.OK
                );
            }

            // If we reach here, method was in Config.PAYMENT_METHODS but not handled
            return apiError(
                c,
                `Withdrawal method '${withdraw.method}' is not yet implemented`,
                HTTP_STATUS.BAD_REQUEST
            );
        } catch (error) {
            logger.error(error);

            if (
                error instanceof OxapayServiceUnavailableError ||
                error instanceof CxpayServiceUnavailableError ||
                error instanceof XdpayServiceUnavailableError
            ) {
                let parsedError: any = error.message;
                if (error.responseBody) {
                    try {
                        parsedError = JSON.parse(error.responseBody);
                    } catch (e) {
                        // Keep as message string if parsing fails
                    }
                }

                return c.json(
                    {
                        success: false,
                        error: parsedError,
                    },
                    error.statusCode as any
                );
            }

            return apiError(
                c,
                "Internal server error",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
