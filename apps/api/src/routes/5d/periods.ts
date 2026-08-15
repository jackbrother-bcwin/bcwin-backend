import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import {
    fiveDPeriodResponseSchema,
    fiveDPeriodsRequestSchema,
} from "@/schemas/5d";

const logger = new Logger("5d-periods");

const fiveDPeriodsResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the periods were fetched successfully",
        example: true,
    }),
    periods: z.array(fiveDPeriodResponseSchema).openapi({
        description: "List of 5D periods",
    }),
    currentPeriod: fiveDPeriodResponseSchema.nullable().openapi({
        description: "Current active period for the duration, null if none",
    }),
    total: z.number().openapi({
        description: "Total number of periods",
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

const fiveDPeriodsRoute = createRoute({
    method: "get",
    tags: ["5d"],
    path: "/periods",
    request: {
        cookies: authCookie,
        query: fiveDPeriodsRequestSchema,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: fiveDPeriodsResponseSchema,
                },
            },
            description: "Get 5D periods",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

export const periodRoutes = (app: OpenAPIHono) => {
    app.openapi(fiveDPeriodsRoute, async (c) => {
        try {
            const { duration, page, limit } = c.req.valid("query");
            const skip = (page - 1) * limit;

            const whereClause = duration ? { durationSeconds: duration } : {};

            const now = new Date();
            const periodSelect = {
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
                status: true,
            } as const;

            // Live period only: ACTIVE + still inside window (avoids sticky 00)
            const [periods, total, currentPeriod] = await Promise.all([
                prisma.fiveDPeriod.findMany({
                    where: whereClause,
                    orderBy: { startTime: "desc" },
                    take: limit,
                    skip,
                    select: periodSelect,
                }),
                prisma.fiveDPeriod.count({ where: whereClause }),
                prisma.fiveDPeriod.findFirst({
                    where: {
                        ...whereClause,
                        status: "ACTIVE",
                        startTime: { lte: now },
                        endTime: { gt: now },
                    },
                    orderBy: { startTime: "desc" },
                    select: periodSelect,
                }),
            ]);

            const totalPages = Math.ceil(total / limit);

            return c.json(
                {
                    success: true,
                    periods: periods.map((period) => ({
                        ...period,
                        startTime: period.startTime.toISOString(),
                        endTime: period.endTime.toISOString(),
                    })),
                    currentPeriod: currentPeriod
                        ? {
                            ...currentPeriod,
                            startTime: currentPeriod.startTime.toISOString(),
                            endTime: currentPeriod.endTime.toISOString(),
                        }
                        : null,
                    total,
                    currentPage: page,
                    totalPages,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error fetching 5D periods:", error);
            return apiError(
                c,
                "Failed to fetch 5D periods",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
