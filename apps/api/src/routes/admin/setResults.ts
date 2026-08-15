import { createRoute, RouteConfig, OpenAPIHono, z } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { apiError, CommonResponses } from "@/lib/utils";
import { HTTP_STATUS } from "@/lib/http";
import { authCookie } from "@/schemas";
import { ResultSetter } from "@bcwin/cache";

const logger = new Logger("admin-setResults");

const createAdminSetResultsRoute = <T extends RouteConfig>(config: T) => {
    return createRoute({
        tags: ["admin"],
        ...config,
    });
};

const wingoResultSchema = z
    .object({
        number: z.number().int().min(0).max(9).openapi({
            description: "Winning number for Wingo",
            example: 5,
        }),
    })
    .openapi({
        description: "Result of Wingo game",
        example: { number: 5 },
    });

const k3ResultSchema = z
    .object({
        dice1: z.number().int().min(1).max(6),
        dice2: z.number().int().min(1).max(6),
        dice3: z.number().int().min(1).max(6),
    })
    .openapi({
        description: "Result of K3 dice game",
        example: { dice1: 2, dice2: 3, dice3: 6 },
    });

const fiveDResultSchema = z
    .object({
        resultNumber: z
            .string()
            .regex(/^\d{5}$/)
            .openapi({
                description: "5-digit result number",
                example: "12345",
            }),
    })
    .openapi({
        description: "Result of 5D game",
        example: { resultNumber: "12345" },
    });

// const setResultsSchema = z.object({
//     game: z.enum(["wingo", "k3", "5d"]).openapi({
//         description: "The game to set the results for",
//         example: "wingo",
//     }),
//     periodId: z.uuid().openapi({
//         description: "The period ID to set the results for",
//         example: "147f8c93-b8c2-4435-8534-9ac4ad282ca5",
//     }),
//     result: z.discriminatedUnion("game", [
//         z.object({
//           game: z.literal("wingo"),
//           periodId: z.uuid(),
//           result: wingoResultSchema,
//         }),
//         z.object({
//           game: z.literal("k3"),
//           periodId: z.uuid(),
//           result: k3ResultSchema,
//         }),
//         z.object({
//           game: z.literal("5d"),
//           periodId: z.uuid(),
//           result: fiveDResultSchema,
//         }),
//       ])
// });

const PeriodIdSchema = z.uuid().openapi({
    description: "The period ID to set the results for",
    example: "147f8c93-b8c2-4435-8534-9ac4ad282ca5",
});

const setResultsSchema = z.discriminatedUnion("game", [
    z.object({
        game: z.literal("wingo"),
        periodId: PeriodIdSchema,
        result: wingoResultSchema,
    }),
    z.object({
        game: z.literal("k3"),
        periodId: PeriodIdSchema,
        result: k3ResultSchema,
    }),
    z.object({
        game: z.literal("5d"),
        periodId: PeriodIdSchema,
        result: fiveDResultSchema,
    }),
]);

// The main response schema for the entire overview
const setResultsResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the game results were set successfully",
        example: true,
    }),
});

const SetResultsRoute = createAdminSetResultsRoute({
    method: "post",
    path: "/setResults",
    summary: "Set the game results",
    description: "Set the game results",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: setResultsSchema,
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: setResultsResponseSchema,
                },
            },
            description: "Game results set successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

const GetFixedResultRoute = createAdminSetResultsRoute({
    method: "get",
    path: "/setResults/fixed",
    summary: "Get admin-fixed prediction for an active period",
    description:
        "Returns the prediction locked by admin for this period (from Redis), if any",
    request: {
        query: z.object({
            game: z.enum(["wingo", "k3", "5d", "moto"]).openapi({
                description: "Game key",
                example: "wingo",
            }),
            periodId: z.string().uuid().openapi({
                description: "Active period UUID",
            }),
        }),
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        fixed: z
                            .union([
                                wingoResultSchema,
                                k3ResultSchema,
                                fiveDResultSchema,
                                z.object({
                                    firstPlace: z.number(),
                                    secondPlace: z.number(),
                                    thirdPlace: z.number(),
                                }),
                            ])
                            .nullable(),
                    }),
                },
            },
            description: "Fixed prediction (or null if not set)",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

export const setResultsRoutes = (app: OpenAPIHono) => {
    app.openapi(GetFixedResultRoute, async (c) => {
        try {
            const { game, periodId } = c.req.valid("query");
            const fixed = await ResultSetter.get(game, periodId);
            return c.json(
                { success: true, fixed },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error(error);
            return apiError(
                c,
                "Internal server error",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.openapi(SetResultsRoute, async (c) => {
        try {
            const { game, periodId, result } = c.req.valid("json");

            const response = await ResultSetter.set(game, periodId, result);

            if (!response.success) {
                return apiError(c, response.message, HTTP_STATUS.BAD_REQUEST);
            }

            return c.json(response, HTTP_STATUS.OK);
        } catch (error) {
            logger.error(error);
            return apiError(
                c,
                "Internal server error",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
