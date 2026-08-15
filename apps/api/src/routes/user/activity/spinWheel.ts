import { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import { prisma, PaymentOrderStatus } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import { z } from "@hono/zod-openapi";
import { WebSocketManager } from "@bcwin/websocket";

const logger = new Logger("activity-spin-wheel");

/**
 * Clockwise from top — MUST match frontend SpinPage PRIZES order.
 * Only these amounts are awarded so the wheel always lands on a real slice.
 */
const WHEEL_AMOUNTS = [10, 19, 29, 100, 299, 439, 66, 199] as const;

/**
 * Weighted pick among active DB rewards that appear on the wheel.
 * Returns amount + sliceIndex (0 = top under the gold selector).
 */
async function selectRandomReward(): Promise<{
    amount: number;
    sliceIndex: number;
}> {
    const rewards = await prisma.luckySpinReward.findMany({
        where: { isActive: true, kind: "INVITE" },
    });

    // Only prizes that exist on the visual wheel
    const wheelSet = new Set<number>(WHEEL_AMOUNTS as unknown as number[]);
    const pool = rewards.filter((r) => wheelSet.has(r.amount) && r.probability > 0);

    if (pool.length === 0) {
        // Safe fallback: top slice
        logger.warn("No wheel-aligned LuckySpinReward rows — using ₹10 fallback");
        return { amount: WHEEL_AMOUNTS[0], sliceIndex: 0 };
    }

    const totalWeight = pool.reduce((sum, r) => sum + r.probability, 0);
    const random = Math.random() * totalWeight;
    let cumulativeWeight = 0;

    for (const reward of pool) {
        cumulativeWeight += reward.probability;
        if (random <= cumulativeWeight) {
            const sliceIndex = (WHEEL_AMOUNTS as readonly number[]).indexOf(
                reward.amount
            );
            return {
                amount: reward.amount,
                sliceIndex: sliceIndex >= 0 ? sliceIndex : 0,
            };
        }
    }

    const last = pool[pool.length - 1]!;
    const sliceIndex = (WHEEL_AMOUNTS as readonly number[]).indexOf(last.amount);
    return {
        amount: last.amount,
        sliceIndex: sliceIndex >= 0 ? sliceIndex : 0,
    };
}

/**
 * Calculate extra spins based on cumulative deposit amount from database rules
 */
async function calculateExtraSpins(cumulativeDeposit: number): Promise<number> {
    const rules = await prisma.luckySpinRule.findMany({
        where: { isActive: true, kind: "INVITE" },
        orderBy: { minDeposit: "asc" },
    });

    let totalExtraSpins = 0;

    for (const rule of rules) {
        if (cumulativeDeposit >= rule.minDeposit) {
            totalExtraSpins += rule.spinChances;
        }
    }

    return totalExtraSpins;
}

/**
 * Get the start of the current day (1 AM reset)
 * Day resets at 1 AM, so if current time is before 1 AM, use previous day's 1 AM
 * Otherwise use today's 1 AM
 */
function getDayStart(date: Date): Date {
    const dayStart = new Date(date);
    dayStart.setUTCHours(1, 0, 0, 0);
    dayStart.setUTCMinutes(0);
    dayStart.setUTCSeconds(0);
    dayStart.setUTCMilliseconds(0);

    // If current time is before 1 AM, use previous day's 1 AM
    if (date.getUTCHours() < 1) {
        dayStart.setUTCDate(dayStart.getUTCDate() - 1);
    }

    return dayStart;
}

/**
 * Get or create SpinWheel record and update if needed
 */
async function getOrUpdateSpinWheel(userId: string): Promise<{
    availableSpins: number;
    dailyCumulativeDeposit: number;
    needsReset: boolean;
}> {
    const now = new Date();
    const dayStart = getDayStart(now);

    // Get or create SpinWheel record
    let spinWheel = await prisma.spinWheel.findUnique({
        where: { userId },
    });

    // Check if we need to reset (last reset was before current day start)
    const needsReset = !spinWheel || spinWheel.lastResetDate < dayStart;

    if (needsReset) {
        // Calculate cumulative deposits for the day (from dayStart to now)
        const deposits = await prisma.deposit.aggregate({
            where: {
                userId,
                status: PaymentOrderStatus.SUCCESS,
                createdAt: {
                    gte: dayStart,
                    lte: now,
                },
            },
            _sum: {
                amount: true,
            },
        });

        const cumulativeDeposit = deposits._sum.amount || 0;
        // No daily free spin — spins only from deposit rules (and any manual grants)
        const extraSpins = await calculateExtraSpins(cumulativeDeposit);
        const totalSpins = extraSpins;

        if (spinWheel) {
            spinWheel = await prisma.spinWheel.update({
                where: { userId },
                data: {
                    availableSpins: totalSpins,
                    dailyCumulativeDeposit: cumulativeDeposit,
                    lastResetDate: now,
                    extraSpinsClaimed: false,
                },
            });
        } else {
            spinWheel = await prisma.spinWheel.create({
                data: {
                    userId,
                    availableSpins: totalSpins,
                    dailyCumulativeDeposit: cumulativeDeposit,
                    lastResetDate: now,
                    extraSpinsClaimed: false,
                },
            });
        }
    } else {
        // Always calculate cumulative deposits for the day first
        const deposits = await prisma.deposit.aggregate({
            where: {
                userId,
                status: PaymentOrderStatus.SUCCESS,
                createdAt: {
                    gte: dayStart,
                    lte: now,
                },
            },
            _sum: {
                amount: true,
            },
        });

        const cumulativeDeposit = deposits._sum.amount || 0;
        logger.debug(`Cumulative deposit: ${cumulativeDeposit}`);

        // Spins only from deposit rules (no free daily spin)
        const extraSpins = await calculateExtraSpins(cumulativeDeposit);
        const newTotalSpins = extraSpins;

        // Invite-wheel spins used today only (exclude lucky spins)
        const usedSpins = await prisma.activityBonus.count({
            where: {
                userId,
                type: "SPIN_WHEEL" as any,
                createdAt: {
                    gte: dayStart,
                    lte: now,
                },
                OR: [
                    { metadata: { path: ["wheel"], equals: "invite" } },
                    // legacy rows without wheel tag count as invite
                    { NOT: { metadata: { path: ["wheel"], equals: "lucky" } } },
                ],
            },
        });

        // Baseline from deposit rules minus used; never clamp down mid-day (manual grants).
        const calculated = Math.max(0, newTotalSpins - usedSpins);
        const currentAvailable = spinWheel?.availableSpins ?? 0;
        const newAvailableSpins = Math.max(calculated, currentAvailable);

        logger.debug(
            `Total spins: ${newTotalSpins} (deposit only, no free), Used: ${usedSpins}, calculated=${calculated}, keep=${newAvailableSpins}`
        );

        if (
            spinWheel &&
            (cumulativeDeposit !== spinWheel.dailyCumulativeDeposit ||
                newAvailableSpins !== spinWheel.availableSpins)
        ) {
            logger.debug("Updating spin wheel");

            const shouldMarkClaimed = newAvailableSpins <= 0;

            spinWheel = await prisma.spinWheel.update({
                where: { userId },
                data: {
                    availableSpins: newAvailableSpins,
                    dailyCumulativeDeposit: cumulativeDeposit,
                    extraSpinsClaimed: shouldMarkClaimed,
                },
            });
        }
    }

    // Ensure spinWheel exists (should always be the case at this point)
    if (!spinWheel) {
        throw new Error("Failed to get or create SpinWheel record");
    }

    return {
        availableSpins: spinWheel.availableSpins,
        dailyCumulativeDeposit: spinWheel.dailyCumulativeDeposit,
        needsReset,
    };
}

const spinRuleSchema = z.object({
    minDeposit: z.number(),
    spinChances: z.number(),
});

const spinPrizeSchema = z.object({
    amount: z.number(),
});

const spinStatusResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    data: z.object({
        availableSpins: z.number().openapi({
            description: "Number of spins the user can still use today",
            example: 2,
        }),
        dailyCumulativeDeposit: z.number().optional().openapi({
            description: "Cumulative deposit for today in INR",
            example: 1000,
        }),
        freeSpinsPerDay: z.number().openapi({
            description: "Free spins granted each day (before deposit extras)",
            example: 1,
        }),
        rules: z.array(spinRuleSchema).openapi({
            description:
                "Deposit tiers that grant extra spins (summed when deposit meets threshold)",
        }),
        prizes: z.array(spinPrizeSchema).openapi({
            description: "Active prize amounts on the wheel",
        }),
    }),
});

const spinWheelResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the spin was successful",
        example: true,
    }),
    data: z.object({
        amount: z.number().openapi({
            description: "Amount won from the spin (matches a wheel slice)",
            example: 10,
        }),
        sliceIndex: z.number().int().min(0).openapi({
            description:
                "Wheel slice index under the pointer after spin (0 = top, clockwise)",
            example: 0,
        }),
        newBalance: z.number().openapi({
            description: "User's new balance after spin",
            example: 1250.5,
        }),
        bonusId: z.string().openapi({
            description: "ID of the created activity bonus",
            example: "123e4567-e89b-12d3-a456-426614174000",
        }),
        availableSpins: z.number().openapi({
            description: "Spins remaining after this spin",
            example: 0,
        }),
    }),
});

const spinHistoryQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20).optional(),
});

const spinHistoryItemSchema = z.object({
    id: z.string(),
    amount: z.number(),
    claimAt: z.string().nullable(),
    createdAt: z.string(),
});

const spinHistoryResponseSchema = z.object({
    success: z.boolean(),
    data: z.array(spinHistoryItemSchema),
    total: z.number(),
    currentPage: z.number(),
    totalPages: z.number(),
});

const spinStatusRoute = createRoute({
    method: "get",
    tags: ["user"],
    path: "/spin-wheel",
    summary: "Get spin wheel status",
    description:
        "Returns available spins, today's deposit total, prize list, and deposit→extra-spin rules.",
    request: {
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: spinStatusResponseSchema,
                },
            },
            description: "Spin status retrieved",
        },
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

const spinHistoryRoute = createRoute({
    method: "get",
    tags: ["user"],
    path: "/spin-wheel/history",
    summary: "Get spin wheel win history",
    description: "Paginated list of the user's collected spin-wheel wins.",
    request: {
        cookies: authCookie,
        query: spinHistoryQuerySchema,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: spinHistoryResponseSchema,
                },
            },
            description: "Spin history retrieved",
        },
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

const spinWheelRoute = createRoute({
    method: "post",
    tags: ["user"],
    path: "/spin-wheel",
    summary: "Spin the wheel",
    description:
        "User can spin when availableSpins > 0. Winning amount is credited immediately and recorded as a COLLECTED SPIN_WHEEL bonus.",
    request: {
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: spinWheelResponseSchema,
                },
            },
            description: "Successfully spun the wheel",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

export const spinWheelRoutes = (app: OpenAPIHono) => {
    app.openapi(spinStatusRoute, async (c) => {
        try {
            const user = c.get("user");
            const { availableSpins, dailyCumulativeDeposit } =
                await getOrUpdateSpinWheel(user.id);

            const [rules, prizeRows] = await Promise.all([
                prisma.luckySpinRule.findMany({
                    where: { isActive: true, kind: "INVITE" },
                    orderBy: { minDeposit: "asc" },
                    select: { minDeposit: true, spinChances: true },
                }),
                prisma.luckySpinReward.findMany({
                    where: { isActive: true, kind: "INVITE" },
                    select: { amount: true },
                }),
            ]);

            // Return prizes in wheel order so FE/rules stay aligned with the turntable
            const amountSet = new Set(prizeRows.map((p) => p.amount));
            const prizes = (WHEEL_AMOUNTS as readonly number[])
                .filter((a) => amountSet.has(a))
                .map((amount) => ({ amount }));

            return c.json(
                {
                    success: true,
                    data: {
                        availableSpins,
                        dailyCumulativeDeposit,
                        freeSpinsPerDay: 0,
                        rules,
                        prizes:
                            prizes.length > 0
                                ? prizes
                                : (WHEEL_AMOUNTS as readonly number[]).map(
                                      (amount) => ({ amount })
                                  ),
                    },
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error fetching spin status:", error);
            return apiError(
                c,
                "Failed to fetch spin status",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.openapi(spinHistoryRoute, async (c) => {
        try {
            const user = c.get("user");
            const query = c.req.valid("query");
            const page = query.page ?? 1;
            const limit = query.limit ?? 20;
            const skip = (page - 1) * limit;

            const where = {
                userId: user.id,
                type: "SPIN_WHEEL" as const,
                status: "COLLECTED" as const,
            };

            const [rows, total] = await Promise.all([
                prisma.activityBonus.findMany({
                    where,
                    orderBy: { claimAt: "desc" },
                    take: limit,
                    skip,
                    select: {
                        id: true,
                        amount: true,
                        claimAt: true,
                        createdAt: true,
                    },
                }),
                prisma.activityBonus.count({ where }),
            ]);

            const totalPages = Math.max(1, Math.ceil(total / limit));

            return c.json(
                {
                    success: true,
                    data: rows.map((r) => ({
                        id: r.id,
                        amount: r.amount,
                        claimAt: r.claimAt?.toISOString() ?? null,
                        createdAt: r.createdAt.toISOString(),
                    })),
                    total,
                    currentPage: page,
                    totalPages,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error fetching spin history:", error);
            return apiError(
                c,
                "Failed to fetch spin history",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.openapi(spinWheelRoute, async (c) => {
        try {
            const user = c.get("user");
            const now = new Date();

            // Get or update SpinWheel record
            const { availableSpins } = await getOrUpdateSpinWheel(user.id);

            if (availableSpins <= 0) {
                return apiError(
                    c,
                    "You have no spins available. Please try again tomorrow.",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            // Weighted pick — amount always maps to a visible wheel slice
            const { amount: winningAmount, sliceIndex } =
                await selectRandomReward();

            // Create bonus, update balance, and decrement spins in transaction
            const result = await prisma.$transaction(async (tx) => {
                // Create bonus with status COLLECTED and claimAt as now
                const bonus = await tx.activityBonus.create({
                    data: {
                        userId: user.id,
                        type: "SPIN_WHEEL" as any,
                        status: "COLLECTED",
                        amount: winningAmount,
                        claimAt: now,
                        metadata: {
                            spinDate: now.toISOString(),
                            sliceIndex,
                            wheel: "invite",
                        },
                    },
                });

                // Update user balance
                const updatedUser = await tx.user.update({
                    where: { id: user.id },
                    data: { balance: { increment: winningAmount } },
                    select: { balance: true },
                });

                // Get current spin wheel state to check if we're using an extra spin
                const currentSpinWheel = await tx.spinWheel.findUnique({
                    where: { userId: user.id },
                    select: { availableSpins: true },
                });

                // Decrement available spins (no free daily spin)
                const newAvailableSpins =
                    (currentSpinWheel?.availableSpins ?? 1) - 1;
                const updatedSpinWheel = await tx.spinWheel.update({
                    where: { userId: user.id },
                    data: {
                        availableSpins: { decrement: 1 },
                        extraSpinsClaimed: newAvailableSpins <= 0,
                    },
                });

                return { bonus, updatedUser, updatedSpinWheel };
            });

            // Publish balance update via WebSocket
            WebSocketManager.publishToUser(user.id, "account-balance", {
                balance: result.updatedUser.balance,
            });

            logger.info(
                `User ${user.id} invite-spun and won ${winningAmount}. New balance: ${result.updatedUser.balance}. Remaining spins: ${result.updatedSpinWheel.availableSpins}`
            );

            return c.json(
                {
                    success: true,
                    data: {
                        amount: winningAmount,
                        sliceIndex,
                        newBalance: result.updatedUser.balance,
                        bonusId: result.bonus.id,
                        availableSpins: result.updatedSpinWheel.availableSpins,
                    },
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error spinning wheel:", error);
            return apiError(
                c,
                "Failed to spin wheel",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
