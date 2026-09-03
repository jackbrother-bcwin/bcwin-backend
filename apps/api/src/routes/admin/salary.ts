import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie, limit, page } from "@/schemas";
import { prisma, SalaryFrequency } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import { WebSocketManager } from "@bcwin/websocket";
import { generateOrderId } from "@/lib/payment";
import { autoSalaryRoutes } from "./salaryAuto";
import { adminUserSearchOr, normalizeAdminUserSearch } from "@/lib/adminUserSearch";

const logger = new Logger("admin-salary");

// ===================== Schemas =====================

const SalaryRuleSchema = z.object({
    id: z.string(),
    userId: z.string(),
    amount: z.number(),
    frequency: z.enum(SalaryFrequency),
    maxPayments: z.number().nullable().optional(),
    paidCount: z.number(),
    startDate: z.string(),
    nextPaymentAt: z.string(),
    immediateFirst: z.boolean(),
    addToTurnover: z.boolean(),
    remark: z.string().nullable().optional(),
    isActive: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    user: z
        .object({
            id: z.string().optional(),
            serialNumber: z.number(),
            username: z.string(),
            mobileNumber: z.string(),
        })
        .optional(),
});

// ===================== Route definitions =====================

// Statistics
const getStatisticsRoute = createRoute({
    method: "get",
    path: "/statistics",
    tags: ["admin"],
    summary: "Get salary statistics",
    description:
        "Get salary statistics including total paid, active rules, total users, frequency distribution",
    request: {
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        totalPaid: z.number(),
                        activeRules: z.number(),
                        totalUsers: z.number(),
                        frequencyDistribution: z.record(z.string(), z.number()),
                    }),
                },
            },
            description: "Salary statistics retrieved successfully",
        },
        ...CommonResponses.internalServerError(),
    },
});

// List
const listRulesRoute = createRoute({
    method: "get",
    path: "/list",
    tags: ["admin"],
    summary: "List salary rules",
    description:
        "Get a paginated list of salary rules, optionally filtered by user or status",
    request: {
        query: z.object({
            page,
            limit,
            userId: z.string().optional().openapi({
                description: "Filter by exact user UUID",
            }),
            status: z.enum(["ACTIVE", "STOPPED", "ALL"]).optional().openapi({
                description: "Filter by rule status",
            }),
            search: z.string().optional().openapi({
                description:
                    "Search by username, phone number, or exact serial prefixed with #",
                example: "#10009",
            }),
        }),
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        rules: z.array(SalaryRuleSchema),
                        total: z.number(),
                        currentPage: z.number(),
                        totalPages: z.number(),
                    }),
                },
            },
            description: "Salary rules retrieved successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

// Create
const createRuleRoute = createRoute({
    method: "post",
    path: "/create",
    tags: ["admin"],
    summary: "Create a salary rule or give instant salary",
    description:
        "Create a new salary rule for a user or agent. Identify the user by providing any one of: userId (UUID), serialNumber, or number (mobile number).",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: z
                        .object({
                            userId: z.string().optional().openapi({
                                description: "User ID (uuid)",
                                example: "uuid-123",
                            }),
                            serialNumber: z.number().int().optional().openapi({
                                description: "User serial number",
                                example: 10009,
                            }),
                            number: z.string().optional().openapi({
                                description: "User mobile number",
                                example: "9876543210",
                            }),
                            amount: z.number().positive().openapi({
                                description: "Salary amount per payment",
                                example: 500,
                            }),
                            frequency: z.enum(SalaryFrequency).openapi({
                                description: "Payment frequency",
                                example: SalaryFrequency.DAILY,
                            }),
                            maxPayments: z.number().int().positive().optional().openapi({
                                description:
                                    "Optional max number of payments (leave blank for ongoing)",
                                example: 30,
                            }),
                            startDate: z.string().optional().openapi({
                                description: "Start date (ISO 8601, defaults to now)",
                                example: "2025-10-22T00:00:00Z",
                            }),
                            immediateFirst: z
                                .boolean()
                                .optional()
                                .default(false)
                                .openapi({
                                    description:
                                        "Process the first payment immediately on creation",
                                    example: false,
                                }),
                            addToTurnover: z
                                .boolean()
                                .optional()
                                .default(false)
                                .openapi({
                                    description:
                                        "Include salary payments in turnover/wager calculation",
                                    example: false,
                                }),
                            remark: z.string().optional().openapi({
                                description: "Remark / note visible in user transaction history",
                                example: "Weekly performance bonus",
                            }),
                        })
                        .refine(
                            (data) =>
                                data.userId ||
                                data.serialNumber !== undefined ||
                                data.number,
                            {
                                message:
                                    "At least one of userId, serialNumber, or number must be provided",
                            }
                        ),
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        message: z.string(),
                        rule: SalaryRuleSchema,
                    }),
                },
            },
            description: "Salary rule created successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

// Update
const updateRuleRoute = createRoute({
    method: "patch",
    path: "/:id",
    tags: ["admin"],
    summary: "Update a salary rule",
    description: "Update an existing salary rule (amount, frequency, status, remark)",
    request: {
        params: z.object({
            id: z.string().openapi({ description: "Salary rule ID" }),
        }),
        body: {
            content: {
                "application/json": {
                    schema: z.object({
                        amount: z.number().positive().optional().openapi({
                            description: "Salary amount per payment",
                            example: 500,
                        }),
                        frequency: z.enum(SalaryFrequency).optional().openapi({
                            description: "Payment frequency",
                            example: SalaryFrequency.MONTHLY,
                        }),
                        maxPayments: z.number().int().positive().nullable().optional().openapi({
                            description: "Maximum number of payments",
                            example: 12,
                        }),
                        isActive: z.boolean().optional().openapi({
                            description: "Activate or deactivate/stop the rule",
                            example: true,
                        }),
                        addToTurnover: z.boolean().optional().openapi({
                            description:
                                "Include salary payments in turnover/wager calculation",
                            example: false,
                        }),
                        remark: z.string().nullable().optional().openapi({
                            description: "Remark / note",
                            example: "Updated salary note",
                        }),
                    }),
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        message: z.string(),
                        rule: SalaryRuleSchema,
                    }),
                },
            },
            description: "Salary rule updated successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

// Delete
const deleteRuleRoute = createRoute({
    method: "delete",
    path: "/:id",
    tags: ["admin"],
    summary: "Delete a salary rule",
    description: "Delete a salary rule permanently",
    request: {
        params: z.object({
            id: z.string().openapi({ description: "Salary rule ID" }),
        }),
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        message: z.string(),
                    }),
                },
            },
            description: "Salary rule deleted successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

// ===================== Helpers =====================

const formatRule = (r: any) => ({
    id: r.id,
    userId: r.userId,
    amount: r.amount,
    frequency: r.frequency,
    maxPayments: r.maxPayments ?? null,
    paidCount: r.paidCount,
    startDate:
        r.startDate instanceof Date ? r.startDate.toISOString() : r.startDate,
    nextPaymentAt:
        r.nextPaymentAt instanceof Date
            ? r.nextPaymentAt.toISOString()
            : r.nextPaymentAt,
    immediateFirst: r.immediateFirst,
    addToTurnover: r.addToTurnover,
    remark: r.remark ?? null,
    isActive: r.isActive,
    createdAt:
        r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    updatedAt:
        r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
    user: r.user
        ? {
              id: r.user.id ?? r.userId,
              serialNumber: r.user.serialNumber,
              username: r.user.username,
              mobileNumber: r.user.mobileNumber,
          }
        : undefined,
});

function calculateNextPayment(
    fromDate: Date,
    frequency: string
): Date {
    const next = new Date(fromDate);
    switch (frequency) {
        case "HOURLY":
            next.setHours(next.getHours() + 1);
            break;
        case "DAILY":
            next.setDate(next.getDate() + 1);
            break;
        case "WEEKLY":
            next.setDate(next.getDate() + 7);
            break;
        case "MONTHLY":
            next.setMonth(next.getMonth() + 1);
            break;
        case "ONE_TIME":
            // One-time: nextPaymentAt = startDate (will be processed once)
            break;
    }
    return next;
}

/**
 * Resolve a user from any of the supported identifiers.
 * Priority: userId > serialNumber > number (mobile).
 */
async function resolveUser(params: {
    userId?: string;
    serialNumber?: number;
    number?: string;
}) {
    if (params.userId) {
        return prisma.user.findUnique({ where: { id: params.userId } });
    }
    if (params.serialNumber !== undefined) {
        return prisma.user.findUnique({
            where: { serialNumber: params.serialNumber },
        });
    }
    if (params.number) {
        return prisma.user.findFirst({
            where: { mobileNumber: params.number },
        });
    }
    return null;
}

// ===================== Route handlers =====================

export const salaryRoutes = (app: OpenAPIHono) => {
    // Statistics
    app.openapi(getStatisticsRoute, async (c) => {
        try {
            const cached = await Cache.get<any>(CacheKey.adminSalaryStats);
            if (cached) {
                return c.json({ success: true, ...cached }, HTTP_STATUS.OK);
            }

            const [totalPaidResult, activeRules, activeUserIds, freqDist] =
                await Promise.all([
                    prisma.salaryPayment.aggregate({
                        _sum: { amount: true },
                    }),
                    prisma.salaryRule.count({ where: { isActive: true } }),
                    prisma.salaryRule.findMany({
                        where: { isActive: true },
                        select: { userId: true },
                        distinct: ["userId"],
                    }),
                    prisma.salaryRule.groupBy({
                        by: ["frequency"],
                        where: { isActive: true },
                        _count: true,
                    }),
                ]);

            const frequencyDistribution: Record<string, number> = {};
            for (const item of freqDist) {
                frequencyDistribution[item.frequency] = item._count;
            }

            const result = {
                totalPaid: totalPaidResult._sum.amount || 0,
                activeRules,
                totalUsers: activeUserIds.length,
                frequencyDistribution,
            };

            await Cache.set(CacheKey.adminSalaryStats, result, 60 * 5);

            return c.json({ success: true, ...result }, HTTP_STATUS.OK);
        } catch (error) {
            logger.error(error);
            return apiError(
                c,
                "Internal server error",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    // List rules
    app.openapi(listRulesRoute, async (c) => {
        try {
            const { page, limit, search, userId, status } = c.req.valid("query");
            const skip = (page - 1) * limit;

            const where: any = {};

            if (userId) {
                where.userId = userId;
            }

            if (status === "ACTIVE") {
                where.isActive = true;
            } else if (status === "STOPPED") {
                where.isActive = false;
            }

            // Build user search filter
            const normalizedSearch = normalizeAdminUserSearch(search);
            if (normalizedSearch) {
                where.user = {
                    OR: adminUserSearchOr(normalizedSearch),
                };
            }

            const [rules, total] = await Promise.all([
                prisma.salaryRule.findMany({
                    where,
                    take: limit,
                    skip,
                    orderBy: { createdAt: "desc" as const },
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
                prisma.salaryRule.count({ where }),
            ]);

            const totalPages = Math.ceil(total / limit);

            return c.json(
                {
                    success: true,
                    rules: rules.map(formatRule),
                    total,
                    currentPage: page,
                    totalPages,
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

    // Create rule / Give instant salary
    app.openapi(createRuleRoute, async (c) => {
        try {
            const body = c.req.valid("json");
            const {
                amount,
                frequency,
                maxPayments,
                startDate,
                immediateFirst,
                addToTurnover,
                remark,
            } = body;

            // Resolve user from any provided identifier (userId, serialNumber, or number)
            const user = await resolveUser({
                userId: body.userId,
                serialNumber: body.serialNumber,
                number: body.number,
            });

            if (!user) {
                return apiError(c, "User not found", HTTP_STATUS.BAD_REQUEST);
            }

            const userId = user.id;

            const isOneTime = frequency === "ONE_TIME";
            const shouldPayImmediately = isOneTime || immediateFirst || false;

            const actualMaxPayments = isOneTime ? 1 : (maxPayments ?? null);

            const start = startDate ? new Date(startDate) : new Date();
            let nextPaymentAt: Date;

            if (shouldPayImmediately) {
                nextPaymentAt = isOneTime ? start : calculateNextPayment(new Date(), frequency);
            } else {
                nextPaymentAt = start;
            }

            // Create the rule (and process immediate payment if needed)
            const result = await prisma.$transaction(async (tx) => {
                const rule = await tx.salaryRule.create({
                    data: {
                        user: { connect: { id: userId } },
                        amount,
                        frequency: frequency as any,
                        maxPayments: actualMaxPayments ?? undefined,
                        startDate: start,
                        nextPaymentAt,
                        immediateFirst: shouldPayImmediately,
                        addToTurnover,
                        remark: remark?.trim() || null,
                        paidCount: shouldPayImmediately ? 1 : 0,
                        isActive: isOneTime ? false : true,
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
                });

                if (shouldPayImmediately) {
                    // Credit user balance
                    await tx.user.update({
                        where: { id: userId },
                        data: { balance: { increment: amount } },
                    });

                    // Record payment
                    await tx.salaryPayment.create({
                        data: {
                            user: { connect: { id: userId } },
                            salaryRule: { connect: { id: rule.id } },
                            amount,
                            remark: remark?.trim() || null,
                        },
                    });

                    // Add to turnover (create deposit record)
                    if (addToTurnover) {
                        await tx.deposit.create({
                            data: {
                                userId,
                                amount,
                                method: "SALARY",
                                status: "SUCCESS",
                                orderId: generateOrderId(),
                            },
                        });
                    }
                }

                return rule;
            });

            // Send balance update via websocket if immediate payment was made
            if (shouldPayImmediately) {
                const updatedUser = await prisma.user.findUnique({
                    where: { id: userId },
                    select: { balance: true },
                });
                if (updatedUser) {
                    WebSocketManager.publishToUser(
                        userId,
                        "account-balance",
                        { balance: updatedUser.balance }
                    );
                }
            }

            // Invalidate caches
            await Promise.all([
                Cache.del(CacheKey.adminSalaryRules),
                Cache.del(CacheKey.adminSalaryStats),
                Cache.del(CacheKey.userSalaryHistory(userId)),
            ]);

            logger.info("Salary rule created", {
                id: result.id,
                userId,
                amount,
                frequency,
                remark,
            });

            return c.json(
                {
                    success: true,
                    message: shouldPayImmediately
                        ? "Salary credited successfully"
                        : "Salary rule created successfully",
                    rule: formatRule(result),
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

    // Update rule
    app.openapi(updateRuleRoute, async (c) => {
        try {
            const { id } = c.req.valid("param");
            const updates = c.req.valid("json");

            const existing = await prisma.salaryRule.findUnique({
                where: { id },
            });

            if (!existing) {
                return apiError(
                    c,
                    "Salary rule not found",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            const updateData: any = {};
            if (updates.amount !== undefined) updateData.amount = updates.amount;
            if (updates.frequency !== undefined)
                updateData.frequency = updates.frequency;
            if (updates.maxPayments !== undefined)
                updateData.maxPayments = updates.maxPayments;
            if (updates.isActive !== undefined)
                updateData.isActive = updates.isActive;
            if (updates.addToTurnover !== undefined)
                updateData.addToTurnover = updates.addToTurnover;
            if (updates.remark !== undefined)
                updateData.remark = updates.remark?.trim() || null;

            const rule = await prisma.salaryRule.update({
                where: { id },
                data: updateData,
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
            });

            await Promise.all([
                Cache.del(CacheKey.adminSalaryRules),
                Cache.del(CacheKey.adminSalaryStats),
                Cache.del(CacheKey.userSalaryHistory(existing.userId)),
            ]);

            logger.info("Salary rule updated", { id });

            return c.json(
                {
                    success: true,
                    message: updates.isActive === false
                        ? "Salary rule stopped"
                        : updates.isActive === true
                          ? "Salary rule activated"
                          : "Salary rule updated successfully",
                    rule: formatRule(rule),
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

    // Delete rule
    app.openapi(deleteRuleRoute, async (c) => {
        try {
            const { id } = c.req.valid("param");

            const existing = await prisma.salaryRule.findUnique({
                where: { id },
            });

            if (!existing) {
                return apiError(
                    c,
                    "Salary rule not found",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            await prisma.salaryRule.delete({ where: { id } });

            await Promise.all([
                Cache.del(CacheKey.adminSalaryRules),
                Cache.del(CacheKey.adminSalaryStats),
                Cache.del(CacheKey.userSalaryHistory(existing.userId)),
            ]);

            logger.info("Salary rule deleted", { id });

            return c.json(
                {
                    success: true,
                    message: "Salary rule deleted successfully",
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

    // Automatic salary slabs (generate → approve / reject)
    autoSalaryRoutes(app);
};
