import { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";

import { prisma, PaymentOrderStatus } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import { WebSocketManager } from "@bcwin/websocket";
import {
    DEFAULT_LUCKY_SPIN_RULES,
    mergeLuckySpinsAwarded,
    readLuckySpinsAwarded,
    spinsForDepositAmount,
} from "@/lib/luckySpinTiers";

const logger = new Logger("activity-lucky-spin");

/**
 * Cash-only amounts on the Lucky Spin face (iPhone is FE visual only).
 * Order matches LuckySpinPage PRIZES cash indices (skip phone at 0):
 * FE: phone, 50, 5000, 10, 2, 100, 1000, 5
 * BE awards only these ₹ amounts; sliceIndex is FE face index.
 */
const LUCKY_CASH: ReadonlyArray<{ amount: number; sliceIndex: number }> = [
    { amount: 50, sliceIndex: 1 },
    { amount: 5000, sliceIndex: 2 },
    { amount: 10, sliceIndex: 3 },
    { amount: 2, sliceIndex: 4 },
    { amount: 100, sliceIndex: 5 },
    { amount: 1000, sliceIndex: 6 },
    { amount: 5, sliceIndex: 7 },
];

function getDayStart(date: Date): Date {
    const dayStart = new Date(date);
    dayStart.setUTCHours(1, 0, 0, 0);
    dayStart.setUTCMinutes(0);
    dayStart.setUTCSeconds(0);
    dayStart.setUTCMilliseconds(0);
    if (date.getUTCHours() < 1) {
        dayStart.setUTCDate(dayStart.getUTCDate() - 1);
    }
    return dayStart;
}

async function selectLuckyReward(): Promise<{
    amount: number;
    sliceIndex: number;
}> {
    const rewards = await prisma.luckySpinReward.findMany({
        where: { isActive: true, kind: "LUCKY" },
    });

    const byAmount = new Map(rewards.map((r) => [r.amount, r.probability]));
    const pool = LUCKY_CASH.map((c) => ({
        ...c,
        probability: byAmount.get(c.amount) ?? 0,
    })).filter((p) => p.probability > 0);

    if (pool.length === 0) {
        logger.warn("No LUCKY rewards — fallback ₹2");
        return { amount: 2, sliceIndex: 4 };
    }

    const totalWeight = pool.reduce((s, p) => s + p.probability, 0);
    let random = Math.random() * totalWeight;
    for (const p of pool) {
        random -= p.probability;
        if (random <= 0) return { amount: p.amount, sliceIndex: p.sliceIndex };
    }
    const last = pool[pool.length - 1]!;
    return { amount: last.amount, sliceIndex: last.sliceIndex };
}

async function loadLuckyRules() {
    const rows = await prisma.luckySpinRule.findMany({
        where: { isActive: true, kind: "LUCKY" },
        orderBy: { minDeposit: "asc" },
        select: { minDeposit: true, spinChances: true },
    });
    return rows.length > 0 ? rows : [...DEFAULT_LUCKY_SPIN_RULES];
}

/**
 * Stamp each SUCCESS recharge with luckySpinsAwarded once (audit).
 * Remaining lucky spins = today's awards − lucky spins used today.
 */
async function getOrUpdateLuckySpins(userId: string): Promise<{
    luckyAvailableSpins: number;
    dailyCumulativeDeposit: number;
}> {
    const now = new Date();
    const dayStart = getDayStart(now);

    let spinWheel = await prisma.spinWheel.findUnique({ where: { userId } });

    const [rules, deposits, usedToday] = await Promise.all([
        loadLuckyRules(),
        prisma.deposit.findMany({
            where: {
                userId,
                status: PaymentOrderStatus.SUCCESS,
                createdAt: { gte: dayStart, lte: now },
            },
            select: { id: true, amount: true, metadata: true },
        }),
        prisma.activityBonus.count({
            where: {
                userId,
                type: "SPIN_WHEEL" as any,
                createdAt: { gte: dayStart, lte: now },
                metadata: { path: ["wheel"], equals: "lucky" },
            },
        }),
    ]);

    let awardedToday = 0;
    let cumulativeDeposit = 0;
    for (const d of deposits) {
        cumulativeDeposit += Number(d.amount) || 0;
        const already = readLuckySpinsAwarded(d.metadata);
        if (already != null) {
            awardedToday += already;
            continue;
        }
        const n = spinsForDepositAmount(Number(d.amount) || 0, rules);
        await prisma.deposit.update({
            where: { id: d.id },
            data: {
                metadata: mergeLuckySpinsAwarded(d.metadata, n) as object,
            },
        });
        awardedToday += n;
    }

    const calculated = Math.max(0, awardedToday - usedToday);

    if (!spinWheel) {
        spinWheel = await prisma.spinWheel.create({
            data: {
                userId,
                availableSpins: 1,
                luckyAvailableSpins: calculated,
                dailyCumulativeDeposit: cumulativeDeposit,
                lastResetDate: now,
                extraSpinsClaimed: false,
            },
        });
    } else if (
        calculated !== spinWheel.luckyAvailableSpins ||
        cumulativeDeposit !== spinWheel.dailyCumulativeDeposit
    ) {
        spinWheel = await prisma.spinWheel.update({
            where: { userId },
            data: {
                luckyAvailableSpins: calculated,
                dailyCumulativeDeposit: cumulativeDeposit,
            },
        });
    }

    return {
        luckyAvailableSpins: spinWheel.luckyAvailableSpins,
        dailyCumulativeDeposit: spinWheel.dailyCumulativeDeposit,
    };
}

const statusSchema = z.object({
    success: z.boolean(),
    data: z.object({
        availableSpins: z.number(),
        dailyCumulativeDeposit: z.number(),
        freeSpinsPerDay: z.number(),
        rules: z.array(
            z.object({ minDeposit: z.number(), spinChances: z.number() })
        ),
        prizes: z.array(z.object({ amount: z.number() })),
    }),
});

const spinResultSchema = z.object({
    success: z.boolean(),
    data: z.object({
        amount: z.number(),
        sliceIndex: z.number().int(),
        newBalance: z.number(),
        bonusId: z.string(),
        availableSpins: z.number(),
    }),
});

const historyQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20).optional(),
});

const statusRoute = createRoute({
    method: "get",
    tags: ["user"],
    path: "/lucky-spin",
    summary: "Lucky Spin status",
    description:
        "Available lucky spins from today's SUCCESS recharges (highest tier per deposit, not stacked), deposit→spin rules, cash prize list.",
    request: { cookies: authCookie },
    responses: {
        200: {
            content: { "application/json": { schema: statusSchema } },
            description: "OK",
        },
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

const spinRoute = createRoute({
    method: "post",
    tags: ["user"],
    path: "/lucky-spin",
    summary: "Spin Lucky Spin wheel",
    description:
        "Spends one lucky spin; credits rupee prize to balance. iPhone is FE-only.",
    request: { cookies: authCookie },
    responses: {
        200: {
            content: { "application/json": { schema: spinResultSchema } },
            description: "Win",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

const historyRoute = createRoute({
    method: "get",
    tags: ["user"],
    path: "/lucky-spin/history",
    summary: "Lucky Spin history",
    request: { cookies: authCookie, query: historyQuerySchema },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        data: z.array(
                            z.object({
                                id: z.string(),
                                amount: z.number(),
                                claimAt: z.string().nullable(),
                                createdAt: z.string(),
                            })
                        ),
                        total: z.number(),
                        currentPage: z.number(),
                        totalPages: z.number(),
                    }),
                },
            },
            description: "OK",
        },
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

export const luckySpinUserRoutes = (app: OpenAPIHono) => {
    app.openapi(statusRoute, async (c) => {
        try {
            const user = c.get("user");
            const { luckyAvailableSpins, dailyCumulativeDeposit } =
                await getOrUpdateLuckySpins(user.id);

            const [rules, prizes] = await Promise.all([
                loadLuckyRules(),
                prisma.luckySpinReward.findMany({
                    where: { isActive: true, kind: "LUCKY" },
                    orderBy: { amount: "asc" },
                    select: { amount: true },
                }),
            ]);

            return c.json(
                {
                    success: true,
                    data: {
                        availableSpins: luckyAvailableSpins,
                        dailyCumulativeDeposit,
                        freeSpinsPerDay: 0,
                        rules,
                        prizes,
                    },
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("lucky-spin status:", error);
            return apiError(
                c,
                "Failed to fetch lucky spin status",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.openapi(historyRoute, async (c) => {
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
                metadata: { path: ["wheel"], equals: "lucky" },
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
                    totalPages: Math.max(1, Math.ceil(total / limit)),
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("lucky-spin history:", error);
            return apiError(
                c,
                "Failed to fetch lucky spin history",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.openapi(spinRoute, async (c) => {
        try {
            const user = c.get("user");
            const now = new Date();
            const { luckyAvailableSpins } = await getOrUpdateLuckySpins(
                user.id
            );

            if (luckyAvailableSpins <= 0) {
                return apiError(
                    c,
                    "You have no lucky spins left. Recharge to earn more.",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            const { amount: winningAmount, sliceIndex } =
                await selectLuckyReward();

            const result = await prisma.$transaction(async (tx) => {
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
                            wheel: "lucky",
                        },
                    },
                });

                const updatedUser = await tx.user.update({
                    where: { id: user.id },
                    data: { balance: { increment: winningAmount } },
                    select: { balance: true },
                });

                const updatedSpin = await tx.spinWheel.update({
                    where: { userId: user.id },
                    data: { luckyAvailableSpins: { decrement: 1 } },
                });

                return { bonus, updatedUser, updatedSpin };
            });

            WebSocketManager.publishToUser(user.id, "account-balance", {
                balance: result.updatedUser.balance,
            });

            logger.info(
                `User ${user.id} lucky-spun ₹${winningAmount}. Remaining lucky: ${result.updatedSpin.luckyAvailableSpins}`
            );

            return c.json(
                {
                    success: true,
                    data: {
                        amount: winningAmount,
                        sliceIndex,
                        newBalance: result.updatedUser.balance,
                        bonusId: result.bonus.id,
                        availableSpins: result.updatedSpin.luckyAvailableSpins,
                    },
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("lucky-spin post:", error);
            return apiError(
                c,
                "Failed to spin",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
