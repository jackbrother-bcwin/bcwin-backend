import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import { isValidYmd } from "@/lib/istDate";
import { rebateTotalsByIstDay } from "@/lib/rebateDayTotals";
import { Cache } from "@bcwin/cache";

const logger = new Logger("rebate-day-totals");

const rowSchema = z.object({
    date: z.string(),
    total: z.number(),
});

const getDayTotalsRoute = createRoute({
    method: "get",
    tags: ["user"],
    path: "/day-totals",
    summary: "Team rebate totals grouped by IST day",
    description:
        "One row per IST calendar day. Used by Agent commission and Transaction history instead of paging every rebate row.",
    request: {
        cookies: authCookie,
        query: z.object({
            startDate: z.string().optional(),
            endDate: z.string().optional(),
            settled: z
                .enum(["true", "false", "all"])
                .optional()
                .default("true"),
        }),
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        data: z.array(rowSchema),
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

export const rebateDayTotalsRoutes = (app: OpenAPIHono) => {
    app.openapi(getDayTotalsRoute, async (c) => {
        try {
            const user = c.get("user");
            const { startDate, endDate, settled } = c.req.valid("query");
            if (startDate && !isValidYmd(startDate)) {
                return apiError(
                    c,
                    "Invalid startDate. Use YYYY-MM-DD",
                    HTTP_STATUS.BAD_REQUEST
                );
            }
            if (endDate && !isValidYmd(endDate)) {
                return apiError(
                    c,
                    "Invalid endDate. Use YYYY-MM-DD",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            const settledFilter =
                settled === "all" ? "all" : settled !== "false";

            const cacheKey = `user:${user.id}:rebate-day-totals`;
            const field = `s:${startDate || "x"}-e:${endDate || "x"}-st:${settled || "true"}`;
            const cached = await Cache.hget<{
                data: Array<{ date: string; total: number }>;
            }>(cacheKey, field);
            if (cached) {
                return c.json({ success: true, ...cached }, HTTP_STATUS.OK);
            }

            const data = await rebateTotalsByIstDay({
                userId: user.id,
                startYmd: startDate,
                endYmd: endDate,
                settled: settledFilter,
            });
            const payload = { data };
            await Cache.hset(cacheKey, field, payload, 30);
            return c.json({ success: true, ...payload }, HTTP_STATUS.OK);
        } catch (error) {
            logger.error("day-totals:", error);
            return apiError(
                c,
                "Failed to load rebate day totals",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
