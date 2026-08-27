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

const personSchema = z.object({
    fromUserId: z.string(),
    username: z.string(),
    serialNumber: z.number().nullable(),
    layer: z.number(),
    commission: z.number(),
    betVolume: z.number(),
    bets: z.number(),
});

const liveBetSchema = z.object({
    id: z.string(),
    fromUserId: z.string(),
    layer: z.number(),
    betAmount: z.number(),
    amount: z.number(),
    rate: z.number(),
    game: z.string(),
    createdAt: z.string(),
    settled: z.boolean(),
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
                            people: z.array(personSchema),
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

const liveBetsRoute = createRoute({
    method: "get",
    tags: ["user"],
    path: "/day-preview/bets",
    summary: "Live today bets for one downline",
    description:
        "Paginated today bets priced at the current day’s rebate level. Not Rebate rows; not in wallet.",
    request: {
        cookies: authCookie,
        query: z.object({
            date: z.string().optional(),
            fromUserId: z.string(),
            page: z.coerce.number().int().min(1).optional().default(1),
            limit: z.coerce.number().int().min(1).max(50).optional().default(10),
        }),
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        data: z.array(liveBetSchema),
                        total: z.number(),
                        currentPage: z.number(),
                        totalPages: z.number(),
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

    app.openapi(liveBetsRoute, async (c) => {
        try {
            const user = c.get("user");
            const { date, fromUserId, page, limit } = c.req.valid("query");
            const ymd = date || ymdIst();
            if (!isValidYmd(ymd)) {
                return apiError(
                    c,
                    "Invalid date format. Use YYYY-MM-DD",
                    HTTP_STATUS.BAD_REQUEST
                );
            }
            const out = await DailyTeamRebate.previewBetsForPerson(
                user.id,
                ymd,
                fromUserId,
                page,
                limit
            );
            return c.json(
                {
                    success: true,
                    data: out.items,
                    total: out.total,
                    currentPage: out.currentPage,
                    totalPages: out.totalPages,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("day-preview bets:", error);
            return apiError(
                c,
                "Failed to load live bets",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    const personBetsRoute = createRoute({
        method: "get",
        tags: ["user"],
        path: "/person-bets",
        summary: "Expand one downline: live today + settled past",
        description:
            "Today’s slice is live preview bets. Earlier days in the range are settled Rebate rows.",
        request: {
            cookies: authCookie,
            query: z.object({
                fromUserId: z.string(),
                startDate: z.string().optional(),
                endDate: z.string().optional(),
                layer: z.coerce.number().int().min(1).max(6).optional(),
                page: z.coerce.number().int().min(1).optional().default(1),
                limit: z.coerce
                    .number()
                    .int()
                    .min(1)
                    .max(50)
                    .optional()
                    .default(10),
            }),
        },
        responses: {
            200: {
                content: {
                    "application/json": {
                        schema: z.object({
                            success: z.boolean(),
                            data: z.array(liveBetSchema),
                            total: z.number(),
                            currentPage: z.number(),
                            totalPages: z.number(),
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

    app.openapi(personBetsRoute, async (c) => {
        try {
            const user = c.get("user");
            const { fromUserId, startDate, endDate, layer, page, limit } =
                c.req.valid("query");
            for (const d of [startDate, endDate]) {
                if (d && !isValidYmd(d)) {
                    return apiError(
                        c,
                        "Invalid date format. Use YYYY-MM-DD",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }
            }
            const out = await DailyTeamRebate.personBetsForAgent(user.id, {
                fromUserId,
                startYmd: startDate,
                endYmd: endDate,
                page,
                limit,
                layer,
            });
            return c.json(
                {
                    success: true,
                    data: out.items,
                    total: out.total,
                    currentPage: out.currentPage,
                    totalPages: out.totalPages,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("person-bets:", error);
            return apiError(
                c,
                "Failed to load person bets",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
