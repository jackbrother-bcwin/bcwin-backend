import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import {
    fiveDResultsRequestSchema,
    fiveDResultResponseSchema,
} from "@/schemas/5d";

const logger = new Logger("5d-results");

const fiveDResultsResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the 5D results were fetched successfully",
        example: true,
    }),
    results: z.array(fiveDResultResponseSchema).openapi({
        description: "List of 5D period results",
    }),
    total: z.number().openapi({
        description: "Total number of results",
        example: 100,
    }),
    currentPage: z.number().openapi({
        description: "Current page number",
        example: 1,
    }),
    totalPages: z.number().openapi({
        description: "Total number of pages",
        example: 5,
    }),
});

const single5DResultResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the 5D result was fetched successfully",
        example: true,
    }),
    result: fiveDResultResponseSchema.openapi({
        description: "5D period result details",
    }),
});

const get5DResultsRoute = createRoute({
    method: "get",
    path: "/results",
    tags: ["5d"],
    request: {
        cookies: authCookie,
        query: fiveDResultsRequestSchema,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: fiveDResultsResponseSchema,
                },
            },
            description: "Get 5D period results",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

const getSingle5DResultRoute = createRoute({
    method: "get",
    path: "/results/{periodId}",
    tags: ["5d"],
    request: {
        cookies: authCookie,
        params: z.object({
            periodId: z.string().uuid().openapi({
                description: "Period ID",
                example: "147f8c93-b8c2-4435-8534-9ac4ad282ca5",
            }),
        }),
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: single5DResultResponseSchema,
                },
            },
            description: "Get specific 5D period result",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.notFound(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

export const resultRoutes = (app: OpenAPIHono) => {
    app.openapi(get5DResultsRoute, async (c) => {
        try {
            const user = c.get("user");
            const { duration, page, limit } = c.req.valid("query");
            const skip = (page - 1) * limit;

            // Show drawn results as soon as digits exist (ENDED with result or RESOLVED)
            // — waiting for RESOLVED only hid history until settlement finished.
            const whereClause = {
                resultNumber: { not: null },
                ...(duration && { durationSeconds: duration }),
            };

            const [periods, total] = await Promise.all([
                prisma.fiveDPeriod.findMany({
                    where: whereClause,
                    orderBy: { startTime: "desc" },
                    take: limit,
                    skip,
                    select: {
                        id: true,
                        periodNumber: true,
                        durationSeconds: true,
                        startTime: true,
                        endTime: true,
                        resultNumber: true,
                        resultDigitA: true,
                        resultDigitB: true,
                        resultDigitC: true,
                        resultDigitD: true,
                        resultDigitE: true,
                        resultSum: true,
                        fiveDBets: {
                            where: { userId: user.id },
                            select: {
                                id: true,
                                betAmount: true,
                                betCategory: true,
                                betType: true,
                                position: true,
                                betChoice: true,
                                fiveDBetResult: {
                                    select: {
                                        isWin: true,
                                        winAmount: true,
                                        multiplier: true,
                                    },
                                },
                            },
                        },
                    },
                }),
                prisma.fiveDPeriod.count({ where: whereClause }),
            ]);

            const totalPages = Math.ceil(total / limit);

            return c.json(
                {
                    success: true,
                    results: periods.map((period) => ({
                        id: period.id,
                        periodNumber: period.periodNumber,
                        durationSeconds: period.durationSeconds,
                        startTime: period.startTime.toISOString(),
                        endTime: period.endTime.toISOString(),
                        resultNumber: period.resultNumber!,
                        resultDigitA: period.resultDigitA!,
                        resultDigitB: period.resultDigitB!,
                        resultDigitC: period.resultDigitC!,
                        resultDigitD: period.resultDigitD!,
                        resultDigitE: period.resultDigitE!,
                        resultSum: period.resultSum!,
                        userBets:
                            period.fiveDBets.length > 0
                                ? period.fiveDBets.map((bet) => ({
                                    id: bet.id,
                                    betAmount: bet.betAmount,
                                    betCategory: bet.betCategory,
                                    betType: bet.betType,
                                    position: bet.position,
                                    betChoice: bet.betChoice,
                                    isWin: bet.fiveDBetResult?.isWin ?? false,
                                    winAmount:
                                        bet.fiveDBetResult?.winAmount ?? 0,
                                    multiplier:
                                        bet.fiveDBetResult?.multiplier ??
                                        null,
                                }))
                                : null,
                    })),
                    total,
                    currentPage: page,
                    totalPages,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error fetching 5D results:", error);
            return apiError(
                c,
                "Failed to fetch 5D results",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.openapi(getSingle5DResultRoute, async (c) => {
        try {
            const user = c.get("user");
            const { periodId } = c.req.valid("param");

            const period = await prisma.fiveDPeriod.findFirst({
                where: {
                    id: periodId,
                    resultNumber: { not: null },
                },
                select: {
                    id: true,
                    periodNumber: true,
                    durationSeconds: true,
                    startTime: true,
                    endTime: true,
                    resultNumber: true,
                    resultDigitA: true,
                    resultDigitB: true,
                    resultDigitC: true,
                    resultDigitD: true,
                    resultDigitE: true,
                    resultSum: true,
                    fiveDBets: {
                        where: { userId: user.id },
                        select: {
                            id: true,
                            betAmount: true,
                            betCategory: true,
                            betType: true,
                            position: true,
                            betChoice: true,
                            fiveDBetResult: {
                                select: {
                                    isWin: true,
                                    winAmount: true,
                                    multiplier: true,
                                },
                            },
                        },
                    },
                },
            });

            if (!period) {
                return apiError(
                    c,
                    "5D period not found or not resolved",
                    HTTP_STATUS.NOT_FOUND
                );
            }

            return c.json(
                {
                    success: true,
                    result: {
                        id: period.id,
                        periodNumber: period.periodNumber,
                        durationSeconds: period.durationSeconds,
                        startTime: period.startTime.toISOString(),
                        endTime: period.endTime.toISOString(),
                        resultNumber: period.resultNumber!,
                        resultDigitA: period.resultDigitA!,
                        resultDigitB: period.resultDigitB!,
                        resultDigitC: period.resultDigitC!,
                        resultDigitD: period.resultDigitD!,
                        resultDigitE: period.resultDigitE!,
                        resultSum: period.resultSum!,
                        userBets:
                            period.fiveDBets.length > 0
                                ? period.fiveDBets.map((bet) => ({
                                    id: bet.id,
                                    betAmount: bet.betAmount,
                                    betCategory: bet.betCategory,
                                    betType: bet.betType,
                                    position: bet.position,
                                    betChoice: bet.betChoice,
                                    isWin: bet.fiveDBetResult?.isWin ?? false,
                                    winAmount:
                                        bet.fiveDBetResult?.winAmount ?? 0,
                                    multiplier:
                                        bet.fiveDBetResult?.multiplier ??
                                        null,
                                }))
                                : null,
                    },
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error fetching 5D result:", error);
            return apiError(
                c,
                "Failed to fetch 5D result",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
