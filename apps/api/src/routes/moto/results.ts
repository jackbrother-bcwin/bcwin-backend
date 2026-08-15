import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import { resultsRequestSchema, motoResultResponseSchema } from "@/schemas/moto";

const logger = new Logger("moto-results");

const resultsResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the results were fetched successfully",
        example: true,
    }),
    results: z.array(motoResultResponseSchema).openapi({
        description: "List of period results",
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

const singleResultResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the result was fetched successfully",
        example: true,
    }),
    result: motoResultResponseSchema.openapi({
        description: "Period result details",
    }),
});

const getResultsRoute = createRoute({
    method: "get",
    path: "/results",
    tags: ["moto"],
    request: {
        cookies: authCookie,
        query: resultsRequestSchema,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: resultsResponseSchema,
                },
            },
            description: "Get period results",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

const getSingleResultRoute = createRoute({
    method: "get",
    path: "/results/{periodId}",
    tags: ["moto"],
    request: {
        cookies: authCookie,
        params: z.object({
            periodId: z.uuid().openapi({
                description: "Period ID",
                example: "147f8c93-b8c2-4435-8534-9ac4ad282ca5",
            }),
        }),
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: singleResultResponseSchema,
                },
            },
            description: "Get specific period result",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.notFound(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

export const resultRoutes = (app: OpenAPIHono) => {
    app.openapi(getResultsRoute, async (c) => {
        try {
            const user = c.get("user");
            const { duration, page, limit } = c.req.valid("query");
            const skip = (page - 1) * limit;

            const whereClause = {
                status: "RESOLVED" as const,
                ...(duration && { durationSeconds: duration }),
            };

            const [periods, total] = await Promise.all([
                prisma.motoPeriod.findMany({
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
                        firstPlace: true,
                        secondPlace: true,
                        thirdPlace: true,
                        motoBets: {
                            where: { userId: user.id },
                            select: {
                                id: true,
                                betAmount: true,
                                betType: true,
                                betChoice: true,
                                targetPosition: true,
                                motoBetResult: {
                                    select: {
                                        isWin: true,
                                        winAmount: true,
                                    },
                                },
                            },
                            take: 1,
                        },
                    },
                }),
                prisma.motoPeriod.count({ where: whereClause }),
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
                        firstPlace: period.firstPlace!,
                        secondPlace: period.secondPlace!,
                        thirdPlace: period.thirdPlace!,
                        userBet:
                            period.motoBets.length > 0
                                ? {
                                      id: period.motoBets[0].id,
                                      betAmount: period.motoBets[0].betAmount,
                                      betType: period.motoBets[0].betType,
                                      betChoice: period.motoBets[0].betChoice,
                                      targetPosition:
                                          period.motoBets[0].targetPosition,
                                      isWin:
                                          period.motoBets[0].motoBetResult
                                              ?.isWin ?? false,
                                      winAmount:
                                          period.motoBets[0].motoBetResult
                                              ?.winAmount ?? 0,
                                  }
                                : null,
                    })),
                    total,
                    currentPage: page,
                    totalPages,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error fetching results:", error);
            return apiError(
                c,
                "Failed to fetch results",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.openapi(getSingleResultRoute, async (c) => {
        try {
            const user = c.get("user");
            const { periodId } = c.req.valid("param");

            const period = await prisma.motoPeriod.findUnique({
                where: {
                    id: periodId,
                    status: "RESOLVED",
                },
                select: {
                    id: true,
                    periodNumber: true,
                    durationSeconds: true,
                    startTime: true,
                    endTime: true,
                    firstPlace: true,
                    secondPlace: true,
                    thirdPlace: true,
                    motoBets: {
                        where: { userId: user.id },
                        select: {
                            id: true,
                            betAmount: true,
                            betType: true,
                            betChoice: true,
                            targetPosition: true,
                            motoBetResult: {
                                select: {
                                    isWin: true,
                                    winAmount: true,
                                },
                            },
                        },
                        take: 1,
                    },
                },
            });

            if (!period) {
                return apiError(
                    c,
                    "Period not found or not resolved",
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
                        firstPlace: period.firstPlace!,
                        secondPlace: period.secondPlace!,
                        thirdPlace: period.thirdPlace!,
                        userBet:
                            period.motoBets.length > 0
                                ? {
                                      id: period.motoBets[0].id,
                                      betAmount: period.motoBets[0].betAmount,
                                      betType: period.motoBets[0].betType,
                                      betChoice: period.motoBets[0].betChoice,
                                      targetPosition:
                                          period.motoBets[0].targetPosition,
                                      isWin:
                                          period.motoBets[0].motoBetResult
                                              ?.isWin ?? false,
                                      winAmount:
                                          period.motoBets[0].motoBetResult
                                              ?.winAmount ?? 0,
                                  }
                                : null,
                    },
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error fetching result:", error);
            return apiError(
                c,
                "Failed to fetch result",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
