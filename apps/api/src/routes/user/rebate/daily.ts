import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import { prisma, type RebateGameCategory } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";

const logger = new Logger("rebate-daily");

/** Screenshot order: Lottery → Slots → Casino → Sports → Chess/card */
const CATEGORIES: RebateGameCategory[] = [
    "LOTTERY",
    "SLOTS",
    "CASINO",
    "SPORTS",
    "RUMMY",
];

const categoryEnum = z.enum([
    "LOTTERY",
    "SLOTS",
    "CASINO",
    "SPORTS",
    "RUMMY",
]);

const layerRowSchema = z.object({
    layer: z.number(),
    betAmount: z.number(),
    rate: z.number(),
    totalComm: z.number(),
});

const categoryBlockSchema = z.object({
    category: categoryEnum,
    title: z.string(),
    bettorCount: z.number(),
    rebateLevel: z.number(),
    betAmount: z.number(),
    commissionPayout: z.number(),
    layers: z.array(layerRowSchema),
});

const dailyResponseSchema = z.object({
    success: z.boolean(),
    data: z
        .object({
            date: z.string(),
            settlementTime: z.string(),
            settled: z.boolean(),
            hasData: z.boolean(),
            bettorCount: z.number(),
            totalBetAmount: z.number(),
            totalCommission: z.number(),
            rebateLevel: z.number(),
            categories: z.array(categoryBlockSchema),
        })
        .nullable(),
});

const getRebateDailyRoute = createRoute({
    method: "get",
    tags: ["user"],
    path: "/daily",
    summary: "One-day team rebate settlement summary",
    description:
        "Aggregated rebate for a calendar day (IST): totals + per-category L1–L6 breakdown for Commission Details UI",
    request: {
        cookies: authCookie,
        query: z.object({
            date: z.string().openapi({
                description: "YYYY-MM-DD (IST day)",
                example: "2026-08-01",
            }),
        }),
    },
    responses: {
        200: {
            content: {
                "application/json": { schema: dailyResponseSchema },
            },
            description: "Daily rebate summary",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

function parseYmdStart(ymd: string): Date {
    return new Date(`${ymd}T00:00:00+05:30`);
}

function endExclusiveIst(ymd: string): Date {
    return new Date(parseYmdStart(ymd).getTime() + 24 * 60 * 60 * 1000);
}

/** Display clock for when that IST day's rebates are credited (next calendar day 01:30 IST). */
function nextDaySettlementTime(ymd: string): string {
    try {
        const [ys, ms, ds] = ymd.split("-").map(Number);
        if (ys && ms && ds) {
            const d = new Date(ys, ms - 1, ds + 1);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, "0");
            const day = String(d.getDate()).padStart(2, "0");
            return `${y}-${m}-${day} 01:30:00`;
        }
    } catch {
        /* fallthrough */
    }
    return `${ymd} 01:30:00`;
}

function categoryTitle(cat: RebateGameCategory): string {
    switch (cat) {
        case "LOTTERY":
            return "Lottery commission";
        case "SLOTS":
            return "Slots commission";
        case "CASINO":
            return "Casino commission";
        case "SPORTS":
            return "Sports rebate";
        case "RUMMY":
            return "Chess and card rebates";
        default:
            return cat;
    }
}

export const rebateDailyRoutes = (app: OpenAPIHono) => {
    app.openapi(getRebateDailyRoute, async (c) => {
        try {
            const user = c.get("user");
            const { date } = c.req.valid("query");

            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                return apiError(
                    c,
                    "Invalid date format. Use YYYY-MM-DD",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            let gte: Date;
            let lt: Date;
            try {
                gte = parseYmdStart(date);
                lt = endExclusiveIst(date);
            } catch {
                return apiError(
                    c,
                    "Invalid date format. Use YYYY-MM-DD",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            const vip = await prisma.userVipLevel.findUnique({
                where: { userId: user.id },
                select: { rebateLevel: true },
            });
            // ADR-0012: rates from rebate level (team ladder), not XP VIP
            const rebateLevel = vip?.rebateLevel ?? 0;

            // Rates for display (VIP × category × layer) — fill zeros for empty layers
            const rateConfigs = await prisma.rebateRateConfig.findMany({
                where: { vipLevel: rebateLevel },
            });
            const rateByCat = new Map<
                RebateGameCategory,
                [number, number, number, number, number, number]
            >();
            for (const r of rateConfigs) {
                rateByCat.set(r.category, [
                    r.layer1,
                    r.layer2,
                    r.layer3,
                    r.layer4,
                    r.layer5,
                    r.layer6,
                ]);
            }

            const rebates = await prisma.rebate.findMany({
                where: {
                    userId: user.id,
                    settled: true,
                    createdAt: { gte, lt },
                },
                select: {
                    amount: true,
                    betAmount: true,
                    layer: true,
                    rate: true,
                    gameCategory: true,
                    settled: true,
                    fromUserId: true,
                    receiverVip: true,
                },
            });

            if (rebates.length === 0) {
                return c.json(
                    {
                        success: true,
                        data: {
                            date,
                            settlementTime: nextDaySettlementTime(date),
                            settled: false,
                            hasData: false,
                            bettorCount: 0,
                            totalBetAmount: 0,
                            totalCommission: 0,
                            rebateLevel,
                            categories: CATEGORIES.map((cat) => {
                                const rates =
                                    rateByCat.get(cat) ??
                                    ([0, 0, 0, 0, 0, 0] as [
                                        number,
                                        number,
                                        number,
                                        number,
                                        number,
                                        number,
                                    ]);
                                return {
                                    category: cat,
                                    title: categoryTitle(cat),
                                    bettorCount: 0,
                                    rebateLevel,
                                    betAmount: 0,
                                    commissionPayout: 0,
                                    layers: [1, 2, 3, 4, 5, 6].map((layer) => ({
                                        layer,
                                        betAmount: 0,
                                        rate: rates[layer - 1] ?? 0,
                                        totalComm: 0,
                                    })),
                                };
                            }),
                        },
                    },
                    HTTP_STATUS.OK
                );
            }

            // Prefer snapshot VIP from rows if present
            const snapshotVip =
                rebates.find((r) => r.receiverVip != null)?.receiverVip ??
                rebateLevel;

            const allBettors = new Set<string>();
            let totalBetAmount = 0;
            let totalCommission = 0;
            let allSettled = true;

            type LayerAgg = {
                betAmount: number;
                totalComm: number;
                rate: number;
                bettors: Set<string>;
            };
            type CatAgg = {
                betAmount: number;
                totalComm: number;
                bettors: Set<string>;
                layers: Map<number, LayerAgg>;
            };

            const byCat = new Map<RebateGameCategory, CatAgg>();
            for (const cat of CATEGORIES) {
                byCat.set(cat, {
                    betAmount: 0,
                    totalComm: 0,
                    bettors: new Set(),
                    layers: new Map(),
                });
            }

            for (const r of rebates) {
                const cat = (r.gameCategory ?? "LOTTERY") as RebateGameCategory;
                const bag = byCat.get(cat) ?? byCat.get("LOTTERY")!;
                const layer = r.layer && r.layer >= 1 && r.layer <= 6 ? r.layer : 1;
                const betAmt = Number(r.betAmount ?? 0);
                const amt = Number(r.amount ?? 0);

                totalCommission += amt;
                totalBetAmount += betAmt;
                if (!r.settled) allSettled = false;
                if (r.fromUserId) allBettors.add(r.fromUserId);

                bag.totalComm += amt;
                bag.betAmount += betAmt;
                if (r.fromUserId) bag.bettors.add(r.fromUserId);

                let lay = bag.layers.get(layer);
                if (!lay) {
                    lay = {
                        betAmount: 0,
                        totalComm: 0,
                        rate: Number(r.rate ?? 0),
                        bettors: new Set(),
                    };
                    bag.layers.set(layer, lay);
                }
                lay.betAmount += betAmt;
                lay.totalComm += amt;
                if (r.rate != null) lay.rate = Number(r.rate);
                if (r.fromUserId) lay.bettors.add(r.fromUserId);
            }

            const categories = CATEGORIES.map((cat) => {
                const bag = byCat.get(cat)!;
                const rates =
                    rateByCat.get(cat) ??
                    ([0, 0, 0, 0, 0, 0] as [
                        number,
                        number,
                        number,
                        number,
                        number,
                        number,
                    ]);

                const layers = [1, 2, 3, 4, 5, 6].map((layer) => {
                    const lay = bag.layers.get(layer);
                    const rateFromConfig = rates[layer - 1] ?? 0;
                    return {
                        layer,
                        betAmount: lay?.betAmount ?? 0,
                        rate: lay?.rate || rateFromConfig,
                        totalComm: lay?.totalComm ?? 0,
                    };
                });

                return {
                    category: cat,
                    title: categoryTitle(cat),
                    bettorCount: bag.bettors.size,
                    rebateLevel: snapshotVip,
                    betAmount: bag.betAmount,
                    commissionPayout: bag.totalComm,
                    layers,
                };
            });

            return c.json(
                {
                    success: true,
                    data: {
                        date,
                        settlementTime: nextDaySettlementTime(date),
                        settled: allSettled,
                        hasData: true,
                        bettorCount: allBettors.size,
                        totalBetAmount,
                        totalCommission,
                        rebateLevel: snapshotVip,
                        categories,
                    },
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error building rebate daily summary:", error);
            return apiError(
                c,
                "Failed to load rebate daily summary",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
