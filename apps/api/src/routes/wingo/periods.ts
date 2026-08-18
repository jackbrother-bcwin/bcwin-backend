import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import {
    wingoPeriodResponseSchema,
    periodsRequestSchema,
} from "@/schemas/wingo";

const logger = new Logger("wingo-periods");

const periodsResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the periods were fetched successfully",
        example: true,
    }),
    periods: z.array(wingoPeriodResponseSchema).openapi({
        description: "List of periods",
    }),
    currentPeriod: wingoPeriodResponseSchema.nullable().openapi({
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

const periodsRoute = createRoute({
    method: "get",
    tags: ["wingo"],
    path: "/periods",
    request: {
        cookies: authCookie,
        query: periodsRequestSchema,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: periodsResponseSchema,
                },
            },
            description: "Get periods",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

export const periodRoutes = (app: OpenAPIHono) => {
    app.openapi(periodsRoute, async (c) => {
        try {
            const { duration, page, limit } = c.req.valid("query");
            const skip = (page - 1) * limit;

            const whereClause = duration ? { durationSeconds: duration } : {};

            const now = new Date();
            const [periods, total, currentPeriod] = await Promise.all([
                prisma.wingoPeriod.findMany({
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
                        resultColor: true,
                        resultSize: true,
                        status: true,
                    },
                }),
                prisma.wingoPeriod.count({ where: whereClause }),
                prisma.wingoPeriod.findFirst({
                    where: {
                        ...whereClause,
                        status: "ACTIVE",
                        startTime: { lte: now },
                        endTime: { gt: now },
                    },
                    orderBy: { startTime: "desc" },
                    select: {
                        id: true,
                        periodNumber: true,
                        durationSeconds: true,
                        startTime: true,
                        endTime: true,
                        resultNumber: true,
                        resultColor: true,
                        resultSize: true,
                        status: true,
                    },
                }),
            ]);

            const totalPages = Math.ceil(total / limit);

            const hideResult = <
                T extends {
                    endTime: Date;
                    resultNumber: number | null;
                    resultColor: string | null;
                    resultSize: string | null;
                },
            >(
                period: T
            ) => {
                if (period.endTime.getTime() > now.getTime()) {
                    return {
                        ...period,
                        resultNumber: null,
                        resultColor: null,
                        resultSize: null,
                    };
                }
                return period;
            };

            return c.json(
                {
                    success: true,
                    periods: periods.map((period) => {
                        const p = hideResult(period);
                        return {
                            ...p,
                            startTime: p.startTime.toISOString(),
                            endTime: p.endTime.toISOString(),
                        };
                    }),
                    currentPeriod: currentPeriod
                        ? (() => {
                              const p = hideResult(currentPeriod);
                              return {
                                  ...p,
                                  startTime: p.startTime.toISOString(),
                                  endTime: p.endTime.toISOString(),
                              };
                          })()
                        : null,
                    total,
                    currentPage: page,
                    totalPages,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error fetching periods:", error);
            return apiError(
                c,
                "Failed to fetch periods",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
