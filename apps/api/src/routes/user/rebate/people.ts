import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import { Cache } from "@bcwin/cache";
import {
    rebatePeopleTotals,
    type RebateSettledFilter,
} from "@/lib/rebateDayTotals";
import { isValidYmd } from "@/lib/istDate";

const logger = new Logger("rebate-people");

const personSchema = z.object({
    fromUserId: z.string(),
    username: z.string(),
    serialNumber: z.number().nullable(),
    layer: z.number(),
    commission: z.number(),
    betVolume: z.number(),
    bets: z.number(),
});

const layerSchema = z.object({
    commission: z.number(),
    bet: z.number(),
    users: z.number(),
});

const peopleRoute = createRoute({
    method: "get",
    tags: ["user"],
    path: "/people",
    summary: "Agent commission collapsed by downline",
    description:
        "GROUP BY fromUserId for the IST range. Expand still uses /rebate/history?fromUserId=. Same settled/date rules as history.",
    request: {
        cookies: authCookie,
        query: z.object({
            startDate: z.string().optional(),
            endDate: z.string().optional(),
            settled: z.string().optional(),
            layer: z.coerce.number().int().min(1).max(6).optional(),
        }),
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        data: z.object({
                            people: z.array(personSchema),
                            summary: z.object({
                                commission: z.number(),
                                betVolume: z.number(),
                                bets: z.number(),
                                bettors: z.number(),
                            }),
                            byDay: z.array(
                                z.object({
                                    date: z.string(),
                                    commission: z.number(),
                                })
                            ),
                            byLayer: z.record(z.string(), layerSchema),
                        }),
                    }),
                },
            },
            description: "OK",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

function parseSettled(raw?: string): RebateSettledFilter {
    if (raw === "false") return false;
    if (raw === "all") return "all";
    return true;
}

export const rebatePeopleRoutes = (app: OpenAPIHono) => {
    app.openapi(peopleRoute, async (c) => {
        try {
            const user = c.get("user");
            const { startDate, endDate, settled, layer } = c.req.valid("query");
            for (const d of [startDate, endDate]) {
                if (d && !isValidYmd(d)) {
                    return apiError(
                        c,
                        "Invalid date format. Use YYYY-MM-DD",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }
            }
            const cacheKey = `user:${user.id}:rebate-people`;
            const field = `sd:${startDate || "all"}-ed:${endDate || "all"}-s:${settled || "true"}-L:${layer ?? "all"}`;
            const cached = await Cache.hget<{
                people: unknown;
                summary: unknown;
                byDay: unknown;
                byLayer: unknown;
            }>(cacheKey, field);
            if (cached) {
                return c.json({ success: true, data: cached }, HTTP_STATUS.OK);
            }
            const data = await rebatePeopleTotals({
                userId: user.id,
                startYmd: startDate,
                endYmd: endDate,
                settled: parseSettled(settled),
                layer,
            });
            await Cache.hset(cacheKey, field, data, 20);
            return c.json({ success: true, data }, HTTP_STATUS.OK);
        } catch (error) {
            logger.error("rebate people:", error);
            return apiError(
                c,
                "Failed to load commission people",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
