import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import { prisma, type Prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import { rebateHistoryQuerySchema, rebateRecordSchema } from "@/schemas/rebate";
import { Cache, CacheKey } from "@bcwin/cache";

const logger = new Logger("rebate-history");

const rebateHistoryResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    data: z.array(rebateRecordSchema).openapi({
        description: "Array of rebate records",
    }),
    total: z.number().openapi({
        description: "Total number of rebate records",
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

const getRebateHistoryRoute = createRoute({
    method: "get",
    tags: ["user"],
    path: "/history",
    summary: "Get rebate history",
    description:
        "Team multi-level rebate history with date range, category, game, settled filters",
    request: {
        cookies: authCookie,
        query: rebateHistoryQuerySchema,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: rebateHistoryResponseSchema,
                },
            },
            description: "Successfully retrieved rebate history",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

/** IST calendar day start */
function parseYmdStart(ymd: string): Date {
    return new Date(`${ymd}T00:00:00+05:30`);
}

/** Exclusive end = next IST midnight after ymd */
function endExclusiveIst(ymd: string): Date {
    return new Date(parseYmdStart(ymd).getTime() + 24 * 60 * 60 * 1000);
}

export const rebateHistoryRoutes = (app: OpenAPIHono) => {
    app.openapi(getRebateHistoryRoute, async (c) => {
        try {
            const user = c.get("user");
            const {
                date,
                startDate,
                endDate,
                settled,
                game,
                category,
                fromUserId,
                layer,
                page,
                limit,
            } = c.req.valid("query");

            const skip = (page - 1) * limit;

            const mainCacheKey = CacheKey.rebateHistory(user.id);
            const fieldKey = `sd:${startDate || date || "all"}-ed:${endDate || date || "all"
                }-settled:${settled || "all"}-game:${game || "all"}-cat:${category || "all"
                }-from:${fromUserId || "all"}-layer:${layer ?? "all"
                }-page:${page}-limit:${limit}`;

            const cachedData = await Cache.hget<{
                data: z.infer<typeof rebateRecordSchema>[];
                total: number;
                currentPage: number;
                totalPages: number;
            }>(mainCacheKey, fieldKey);

            if (cachedData) {
                return c.json(
                    { success: true, ...cachedData },
                    HTTP_STATUS.OK
                );
            }

            const whereClause: Prisma.RebateWhereInput = {
                userId: user.id,
            };

            // Date range (prefer start/end; fall back to single `date`)
            if (startDate || endDate || date) {
                try {
                    if (startDate || endDate) {
                        const gte = startDate
                            ? parseYmdStart(startDate)
                            : undefined;
                        const lt = endDate
                            ? endExclusiveIst(endDate)
                            : undefined;
                        whereClause.createdAt = {
                            ...(gte ? { gte } : {}),
                            ...(lt ? { lt } : {}),
                        };
                    } else if (date) {
                        const gte = parseYmdStart(date);
                        const lt = endExclusiveIst(date);
                        whereClause.createdAt = { gte, lt };
                    }
                } catch {
                    return apiError(
                        c,
                        "Invalid date format. Use YYYY-MM-DD",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }
            }

            // Default: only settled (visible after 01:30 IST job). Pass settled=all for raw/unsettled.
            // ADR-0016: uplink TX/history must not show per-bet pending rebate.
            if (settled === undefined || settled === "" || settled === "true") {
                whereClause.settled = true;
            } else if (settled === "false") {
                whereClause.settled = false;
            }
            // settled === "all" → no filter

            if (game && game !== "all") {
                whereClause.game = game.toUpperCase();
            }

            if (category) {
                whereClause.gameCategory = category;
            }

            if (fromUserId) {
                whereClause.fromUserId = fromUserId;
            }

            if (layer != null) {
                whereClause.layer = layer;
            }

            const [rebates, total] = await Promise.all([
                prisma.rebate.findMany({
                    where: whereClause,
                    orderBy: { createdAt: "desc" },
                    take: limit,
                    skip,
                    include: {
                        fromUser: {
                            select: {
                                id: true,
                                username: true,
                                serialNumber: true,
                            },
                        },
                    },
                }),
                prisma.rebate.count({ where: whereClause }),
            ]);

            const totalPages = Math.ceil(total / limit) || 1;

            const result = {
                data: rebates.map((rebate) => ({
                    id: rebate.id,
                    amount: rebate.amount,
                    game: rebate.game,
                    gameCategory: rebate.gameCategory ?? null,
                    layer: rebate.layer ?? null,
                    rate: rebate.rate ?? null,
                    betAmount: rebate.betAmount ?? null,
                    receiverVip: rebate.receiverVip ?? null,
                    fromUser: rebate.fromUser
                        ? {
                            id: rebate.fromUser.id,
                            username: rebate.fromUser.username,
                            serialNumber: rebate.fromUser.serialNumber,
                        }
                        : null,
                    settled: rebate.settled,
                    createdAt: rebate.createdAt.toISOString(),
                })),
                total,
                currentPage: page,
                totalPages,
            };

            // Short TTL so new rebate rows show soon (was 15m)
            await Cache.hset(mainCacheKey, fieldKey, result, 60);

            return c.json({ success: true, ...result }, HTTP_STATUS.OK);
        } catch (error) {
            logger.error("Error fetching rebate history:", error);
            return apiError(
                c,
                "Failed to fetch rebate history",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
