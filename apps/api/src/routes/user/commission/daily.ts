import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import {
    dailyCommissionQuerySchema,
    dailyCommissionSummarySchema,
} from "@/schemas/commission";
import { Cache, CacheKey } from "@bcwin/cache";
import {
    isValidYmd,
    parseYmdEndExclusiveIst,
    parseYmdStartIst,
    ymdIst,
} from "@/lib/istDate";

const logger = new Logger("commission-daily");

/** Live layer totals for one IST day from Commission rows (scheduler only has past days) */
async function liveDaySummary(userId: string, ymd: string) {
    const gte = parseYmdStartIst(ymd);
    const lt = parseYmdEndExclusiveIst(ymd);
    const where = {
        userId,
        OR: [
            { calculationDate: { gte, lt } },
            { createdAt: { gte, lt } },
        ],
    };
    const [total, layers] = await Promise.all([
        prisma.commission.aggregate({
            where,
            _sum: { commissionAmount: true },
        }),
        prisma.commission.groupBy({
            by: ["layer"],
            where,
            _sum: { commissionAmount: true },
        }),
    ]);
    const layerMap: Record<number, number> = {};
    for (const g of layers) {
        layerMap[g.layer] = g._sum.commissionAmount || 0;
    }
    return {
        date: ymd,
        totalCommission: total._sum.commissionAmount || 0,
        layer1Commission: layerMap[1] || 0,
        layer2Commission: layerMap[2] || 0,
        layer3Commission: layerMap[3] || 0,
        layer4Commission: layerMap[4] || 0,
        layer5Commission: layerMap[5] || 0,
        layer6Commission: layerMap[6] || 0,
    };
}

const dailyCommissionResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    data: z.array(dailyCommissionSummarySchema).openapi({
        description: "Array of daily commission summaries",
    }),
    total: z.number().openapi({
        description: "Total number of days with commission records",
        example: 30,
    }),
    currentPage: z.number().openapi({
        description: "Current page number",
        example: 1,
    }),
    totalPages: z.number().openapi({
        description: "Total number of pages",
        example: 3,
    }),
});

const getDailyCommissionRoute = createRoute({
    method: "get",
    tags: ["user"],
    path: "/daily",
    summary: "Get daily commission summary",
    description: "Retrieve daily commission summaries with pagination",
    request: {
        cookies: authCookie,
        query: dailyCommissionQuerySchema,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: dailyCommissionResponseSchema,
                },
            },
            description: "Successfully retrieved daily commission summaries",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

export const dailyCommissionRoutes = (app: OpenAPIHono) => {
    app.openapi(getDailyCommissionRoute, async (c) => {
        try {
            const user = c.get("user");
            const { date, page, limit } = c.req.valid("query");

            const skip = (page - 1) * limit;
            const todayYmd = ymdIst();

            if (date && !isValidYmd(date)) {
                return apiError(
                    c,
                    "Invalid date format. Use YYYY-MM-DD",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            // Single-day request for "today" → always live from Commission table
            // (DailyCommissionSummary is only filled by the night job for past days)
            if (date === todayYmd) {
                const live = await liveDaySummary(user.id, todayYmd);
                return c.json(
                    {
                        success: true,
                        data: [live],
                        total: 1,
                        currentPage: 1,
                        totalPages: 1,
                    },
                    HTTP_STATUS.OK
                );
            }

            // Check cache using hash-based caching
            const mainCacheKey = CacheKey.dailyCommission(user.id);
            const fieldKey = `v2-date:${
                date || "all"
            }-page:${page}-limit:${limit}`;

            const cachedData = await Cache.hget<{
                data: Array<{
                    date: string;
                    totalCommission: number;
                    layer1Commission: number;
                    layer2Commission: number;
                    layer3Commission: number;
                    layer4Commission: number;
                    layer5Commission: number;
                    layer6Commission: number;
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

            let whereClause: {
                userId: string;
                date?: { gte: Date; lt: Date };
            } = {
                userId: user.id,
            };

            // Range covers both UTC-midnight and IST-midnight stored day keys
            if (date) {
                whereClause.date = {
                    gte: parseYmdStartIst(date),
                    lt: parseYmdEndExclusiveIst(date),
                };
            }

            const [summaries, total] = await Promise.all([
                prisma.dailyCommissionSummary.findMany({
                    where: whereClause,
                    orderBy: { date: "desc" },
                    take: limit,
                    skip,
                }),
                prisma.dailyCommissionSummary.count({ where: whereClause }),
            ]);

            let data = summaries.map((summary) => ({
                date:
                    // Prefer calendar day from stored Date (may be UTC midnight)
                    summary.date.toISOString().slice(0, 10),
                totalCommission: summary.totalCommission,
                layer1Commission: summary.layer1Commission,
                layer2Commission: summary.layer2Commission,
                layer3Commission: summary.layer3Commission,
                layer4Commission: summary.layer4Commission,
                layer5Commission: summary.layer5Commission,
                layer6Commission: summary.layer6Commission,
            }));

            // Specific past day with no summary row → still try live Commission rows
            if (date && data.length === 0) {
                const live = await liveDaySummary(user.id, date);
                if (live.totalCommission > 0) {
                    data = [live];
                }
            }

            // List mode page 1: merge live "today" so agent dashboard is not stuck at 0
            if (!date && page === 1) {
                const liveToday = await liveDaySummary(user.id, todayYmd);
                const withoutToday = data.filter((r) => r.date !== todayYmd);
                if (liveToday.totalCommission > 0 || withoutToday.length === 0) {
                    data = [liveToday, ...withoutToday];
                } else {
                    data = [liveToday, ...withoutToday];
                }
            }

            const totalPages = Math.max(1, Math.ceil(total / limit) || 1);

            const result = {
                data,
                total: date ? data.length : total + (page === 1 ? 1 : 0),
                currentPage: page,
                totalPages,
            };

            // Short TTL when list includes live "today"; longer for pure historical
            await Cache.hset(
                mainCacheKey,
                fieldKey,
                result,
                date ? 60 * 10 : 60 * 2
            );

            return c.json(
                {
                    success: true,
                    ...result,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error fetching daily commission:", error);
            return apiError(
                c,
                "Failed to fetch daily commission",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
