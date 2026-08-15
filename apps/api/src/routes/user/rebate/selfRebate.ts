import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import { prisma, type RebateGameCategory } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { WebSocketManager } from "@bcwin/websocket";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import { ymdIst } from "@/lib/istDate";
import { getSelfRebateRatePercent } from "@bcwin/rebate";

const logger = new Logger("self-rebate-api");

const CATEGORIES: RebateGameCategory[] = [
    "LOTTERY",
    "SLOTS",
    "CASINO",
    "SPORTS",
    "RUMMY",
];

const categoryEnum = z.enum(["LOTTERY", "SLOTS", "CASINO", "SPORTS", "RUMMY"]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayIst(): string {
    return ymdIst();
}

function categoryTitle(cat: RebateGameCategory): string {
    switch (cat) {
        case "LOTTERY":
            return "Lottery";
        case "SLOTS":
            return "Slots";
        case "CASINO":
            return "Casino";
        case "SPORTS":
            return "Sports";
        case "RUMMY":
            return "Rummy";
        default:
            return cat;
    }
}

// ─── GET /summary ────────────────────────────────────────────────────────────

const summaryResponseSchema = z.object({
    success: z.boolean(),
    data: z.object({
        todayRebate: z.number(),
        totalRebate: z.number(),
        rate: z.number(),
        vipLevel: z.number().optional(),
        settlementTime: z.string(),
        categories: z.array(
            z.object({
                category: categoryEnum,
                title: z.string(),
                betAmount: z.number(),
                rebateAmount: z.number(),
            })
        ),
    }),
});

const getSummaryRoute = createRoute({
    method: "get",
    tags: ["user"],
    path: "/summary",
    summary: "Self-rebate summary for today",
    description:
        "Returns today's unclaimed self-rebate amount, total lifetime claimed, per-category breakdown",
    request: { cookies: authCookie },
    responses: {
        200: {
            content: {
                "application/json": { schema: summaryResponseSchema },
            },
            description: "Self-rebate summary",
        },
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

// ─── POST /claim ─────────────────────────────────────────────────────────────

const claimResponseSchema = z.object({
    success: z.boolean(),
    data: z.object({
        claimedAmount: z.number(),
        claimedCount: z.number(),
        newBalance: z.number(),
    }),
});

const postClaimRoute = createRoute({
    method: "post",
    tags: ["user"],
    path: "/claim",
    summary: "Claim today's self-rebate",
    description:
        "Claims all unclaimed self-rebates for the current IST day. Credits user balance.",
    request: { cookies: authCookie },
    responses: {
        200: {
            content: {
                "application/json": { schema: claimResponseSchema },
            },
            description: "Claim result",
        },
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

// ─── GET /history ────────────────────────────────────────────────────────────

const historyEntrySchema = z.object({
    category: categoryEnum,
    title: z.string(),
    date: z.string(),
    betAmount: z.number(),
    rate: z.number(),
    rebateAmount: z.number(),
    status: z.enum(["Completed", "Pending", "Expired"]),
});

const historyResponseSchema = z.object({
    success: z.boolean(),
    data: z.array(historyEntrySchema),
    total: z.number(),
    currentPage: z.number(),
    totalPages: z.number(),
});

const getHistoryRoute = createRoute({
    method: "get",
    tags: ["user"],
    path: "/history",
    summary: "Self-rebate history",
    description:
        "Paginated self-rebate history grouped by date and category, with optional category filter",
    request: {
        cookies: authCookie,
        query: z.object({
            category: categoryEnum.optional(),
            page: z.coerce.number().optional().default(1),
            limit: z.coerce.number().optional().default(20),
        }),
    },
    responses: {
        200: {
            content: {
                "application/json": { schema: historyResponseSchema },
            },
            description: "Paginated self-rebate history",
        },
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

// ─── Route Handlers ──────────────────────────────────────────────────────────

export const selfRebateRoutes = (app: OpenAPIHono) => {
    const selfApp = new OpenAPIHono({
        defaultHook: (result, c) => {
            if (!result.success) {
                return c.json(
                    { success: false, error: "Validation error" },
                    400
                );
            }
        },
    });

    // GET /summary
    selfApp.openapi(getSummaryRoute, async (c) => {
        try {
            const user = c.get("user");
            const today = todayIst();

            // Today's unclaimed self-rebates
            const todayRows = await prisma.selfRebate.findMany({
                where: {
                    userId: user.id,
                    date: today,
                    claimed: false,
                    expired: false,
                },
                select: {
                    betAmount: true,
                    amount: true,
                    gameCategory: true,
                },
            });

            const todayRebate = todayRows.reduce(
                (sum, r) => sum + r.amount,
                0
            );

            // Per-category breakdown for today
            const catMap = new Map<
                RebateGameCategory,
                { betAmount: number; rebateAmount: number }
            >();
            for (const cat of CATEGORIES) {
                catMap.set(cat, { betAmount: 0, rebateAmount: 0 });
            }
            for (const row of todayRows) {
                const cat = (row.gameCategory ?? "LOTTERY") as RebateGameCategory;
                const bag = catMap.get(cat) ?? catMap.get("LOTTERY")!;
                bag.betAmount += row.betAmount;
                bag.rebateAmount += row.amount;
            }

            // Total lifetime claimed
            const totalResult = await prisma.selfRebate.aggregate({
                where: {
                    userId: user.id,
                    claimed: true,
                },
                _sum: { amount: true },
            });
            const totalRebate = totalResult._sum.amount ?? 0;

            // Settlement time: next day 01:00 IST
            const [ys, ms, ds] = today.split("-").map(Number);
            const nextDay = new Date(ys!, ms! - 1, ds! + 1);
            const ny = nextDay.getFullYear();
            const nm = String(nextDay.getMonth() + 1).padStart(2, "0");
            const nd = String(nextDay.getDate()).padStart(2, "0");
            const settlementTime = `${ny}-${nm}-${nd} 01:00:00`;

            const vipRow = await prisma.userVipLevel.findUnique({
                where: { userId: user.id },
                select: { currentLevel: true },
            });
            const vipLevel = vipRow?.currentLevel ?? 0;
            const rate = await getSelfRebateRatePercent(vipLevel);

            return c.json(
                {
                    success: true,
                    data: {
                        todayRebate,
                        totalRebate,
                        rate,
                        vipLevel,
                        settlementTime,
                        categories: CATEGORIES.map((cat) => {
                            const bag = catMap.get(cat)!;
                            return {
                                category: cat,
                                title: categoryTitle(cat),
                                betAmount: bag.betAmount,
                                rebateAmount: bag.rebateAmount,
                            };
                        }),
                    },
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error fetching self-rebate summary:", error);
            return apiError(
                c,
                "Failed to load self-rebate summary",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    // POST /claim
    selfApp.openapi(postClaimRoute, async (c) => {
        try {
            const user = c.get("user");
            const today = todayIst();

            // Find all unclaimed rows for today
            const unclaimed = await prisma.selfRebate.findMany({
                where: {
                    userId: user.id,
                    date: today,
                    claimed: false,
                    expired: false,
                },
                select: { id: true, amount: true },
            });

            if (unclaimed.length === 0) {
                const currentUser = await prisma.user.findUnique({
                    where: { id: user.id },
                    select: { balance: true },
                });
                return c.json(
                    {
                        success: true,
                        data: {
                            claimedAmount: 0,
                            claimedCount: 0,
                            newBalance: currentUser?.balance ?? 0,
                        },
                    },
                    HTTP_STATUS.OK
                );
            }

            const totalAmount = unclaimed.reduce(
                (sum, r) => sum + r.amount,
                0
            );
            const ids = unclaimed.map((r) => r.id);
            const now = new Date();

            const updatedUser = await prisma.$transaction(async (tx) => {
                // Mark as claimed
                await tx.selfRebate.updateMany({
                    where: { id: { in: ids } },
                    data: { claimed: true, claimedAt: now },
                });

                // Credit balance
                const user_ = await tx.user.update({
                    where: { id: user.id },
                    data: { balance: { increment: totalAmount } },
                    select: { balance: true },
                });

                return user_;
            });

            // Notify via websocket
            WebSocketManager.publishToUser(user.id, "account-balance", {
                balance: updatedUser.balance,
            });

            logger.info(
                `Self-rebate claimed: ${totalAmount.toFixed(2)} (${ids.length} rows) for user ${user.id}`
            );

            return c.json(
                {
                    success: true,
                    data: {
                        claimedAmount: totalAmount,
                        claimedCount: ids.length,
                        newBalance: updatedUser.balance,
                    },
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error claiming self-rebate:", error);
            return apiError(
                c,
                "Failed to claim self-rebate",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    // GET /history
    selfApp.openapi(getHistoryRoute, async (c) => {
        try {
            const user = c.get("user");
            const { category, page, limit } = c.req.valid("query");
            const skip = (page - 1) * limit;

            const where: {
                userId: string;
                gameCategory?: RebateGameCategory;
            } = { userId: user.id };
            if (category) {
                where.gameCategory = category;
            }

            const rows = await prisma.selfRebate.findMany({
                where,
                select: {
                    date: true,
                    gameCategory: true,
                    betAmount: true,
                    amount: true,
                    rate: true,
                    claimed: true,
                    expired: true,
                },
                orderBy: { createdAt: "desc" },
            });

            const groupedMap = new Map<
                string,
                {
                    date: string;
                    category: RebateGameCategory;
                    betAmount: number;
                    rebateAmount: number;
                    claimed: boolean;
                    expired: boolean;
                }
            >();

            for (const r of rows) {
                const cat = (r.gameCategory ?? "LOTTERY") as RebateGameCategory;
                const key = `${r.date}:${cat}`;
                const existing = groupedMap.get(key);
                if (existing) {
                    existing.betAmount += r.betAmount;
                    existing.rebateAmount += r.amount;
                    if (r.claimed) existing.claimed = true;
                    if (r.expired) existing.expired = true;
                } else {
                    groupedMap.set(key, {
                        date: r.date,
                        category: cat,
                        betAmount: r.betAmount,
                        rebateAmount: r.amount,
                        claimed: r.claimed,
                        expired: r.expired,
                    });
                }
            }

            const allEntries = Array.from(groupedMap.values()).sort((a, b) =>
                b.date.localeCompare(a.date)
            );
            const total = allEntries.length;
            const paged = allEntries.slice(skip, skip + limit);

            const data = paged.map((row) => {
                let status: "Completed" | "Pending" | "Expired" = "Pending";
                if (row.claimed) {
                    status = "Completed";
                } else if (row.expired) {
                    status = "Expired";
                }
                return {
                    category: row.category,
                    title: categoryTitle(row.category),
                    date: row.date,
                    betAmount: row.betAmount,
                    rate:
                        row.betAmount > 0
                            ? (row.rebateAmount / row.betAmount) * 100
                            : 0,
                    rebateAmount: row.rebateAmount,
                    status,
                };
            });

            const totalPages = Math.ceil(total / limit) || 1;

            return c.json(
                {
                    success: true,
                    data,
                    total,
                    currentPage: page,
                    totalPages,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error fetching self-rebate history:", error);
            return apiError(
                c,
                "Failed to fetch self-rebate history",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.route("/self", selfApp);
};
