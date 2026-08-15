import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import { resultsRequestSchema, k3ResultResponseSchema } from "@/schemas/k3";

const logger = new Logger("k3-results");

const resultsResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the results were fetched successfully",
        example: true,
    }),
    results: z.array(k3ResultResponseSchema).openapi({
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
    result: k3ResultResponseSchema.openapi({
        description: "Period result details",
    }),
});

const getResultsRoute = createRoute({
    method: "get",
    path: "/results",
    tags: ["k3"],
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
    tags: ["k3"],
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
                prisma.k3Period.findMany({
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
                        dice1: true,
                        dice2: true,
                        dice3: true,
                        sum: true,
                        isTriple: true,
                        isDouble: true,
                        isAllDifferent: true,
                        isConsecutive: true,
                        isBig: true,
                        isSmall: true,
                        isOdd: true,
                        isEven: true,
                        k3Bets: {
                            where: { userId: user.id },
                            select: {
                                id: true,
                                betAmount: true,
                                betType: true,
                                betChoice: true,
                                k3BetResult: {
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
                prisma.k3Period.count({ where: whereClause }),
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
                        dice1: period.dice1!,
                        dice2: period.dice2!,
                        dice3: period.dice3!,
                        sum: period.sum!,
                        isTriple: period.isTriple!,
                        isDouble: period.isDouble!,
                        isAllDifferent: period.isAllDifferent!,
                        isConsecutive: period.isConsecutive!,
                        isBig: period.isBig!,
                        isSmall: period.isSmall!,
                        isOdd: period.isOdd!,
                        isEven: period.isEven!,
                        userBet:
                            period.k3Bets.length > 0
                                ? {
                                      id: period.k3Bets[0].id,
                                      betAmount: period.k3Bets[0].betAmount,
                                      betType: period.k3Bets[0].betType,
                                      betChoice: period.k3Bets[0].betChoice,
                                      isWin:
                                          period.k3Bets[0].k3BetResult?.isWin ??
                                          false,
                                      winAmount:
                                          period.k3Bets[0].k3BetResult
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

            const period = await prisma.k3Period.findUnique({
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
                    dice1: true,
                    dice2: true,
                    dice3: true,
                    sum: true,
                    isTriple: true,
                    isDouble: true,
                    isAllDifferent: true,
                    isConsecutive: true,
                    isBig: true,
                    isSmall: true,
                    isOdd: true,
                    isEven: true,
                    k3Bets: {
                        where: { userId: user.id },
                        select: {
                            id: true,
                            betAmount: true,
                            betType: true,
                            betChoice: true,
                            k3BetResult: {
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
                        dice1: period.dice1!,
                        dice2: period.dice2!,
                        dice3: period.dice3!,
                        sum: period.sum!,
                        isTriple: period.isTriple!,
                        isDouble: period.isDouble!,
                        isAllDifferent: period.isAllDifferent!,
                        isConsecutive: period.isConsecutive!,
                        isBig: period.isBig!,
                        isSmall: period.isSmall!,
                        isOdd: period.isOdd!,
                        isEven: period.isEven!,
                        userBet:
                            period.k3Bets.length > 0
                                ? {
                                      id: period.k3Bets[0].id,
                                      betAmount: period.k3Bets[0].betAmount,
                                      betType: period.k3Bets[0].betType,
                                      betChoice: period.k3Bets[0].betChoice,
                                      isWin:
                                          period.k3Bets[0].k3BetResult?.isWin ??
                                          false,
                                      winAmount:
                                          period.k3Bets[0].k3BetResult
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
