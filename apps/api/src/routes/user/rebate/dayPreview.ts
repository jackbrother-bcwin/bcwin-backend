import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import { DailyTeamRebate, ymdIst } from "@bcwin/rebate";
import { isValidYmd } from "@/lib/istDate";

const logger = new Logger("rebate-day-preview");

const layerSchema = z.object({
    commission: z.number(),
    bet: z.number(),
    users: z.number(),
});

const previewRoute = createRoute({
    method: "get",
    tags: ["user"],
    path: "/day-preview",
    summary: "Live Agent commission preview for an IST day",
    description:
        "Today-so-far (or a given IST ymd) daily team metrics, qualified rebate level, and estimated commission. Not in wallet until 00:00 IST close.",
    request: {
        cookies: authCookie,
        query: z.object({
            date: z.string().optional().openapi({
                description: "IST YYYY-MM-DD. Default today.",
                example: "2026-08-20",
            }),
        }),
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        data: z.object({
                            date: z.string(),
                            rebateLevel: z.number(),
                            teamSize: z.number(),
                            teamBetting: z.number(),
                            teamDeposit: z.number(),
                            totalCommission: z.number(),
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

export const rebateDayPreviewRoutes = (app: OpenAPIHono) => {
    app.openapi(previewRoute, async (c) => {
        try {
            const user = c.get("user");
            const { date } = c.req.valid("query");
            const ymd = date || ymdIst();
            if (!isValidYmd(ymd)) {
                return apiError(
                    c,
                    "Invalid date format. Use YYYY-MM-DD",
                    HTTP_STATUS.BAD_REQUEST
                );
            }
            const preview = await DailyTeamRebate.previewForUser(user.id, ymd);
            return c.json(
                { success: true, data: { date: ymd, ...preview } },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("day-preview:", error);
            return apiError(
                c,
                "Failed to preview commission",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
