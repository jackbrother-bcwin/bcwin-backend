import { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import {
    activityHistoryQuerySchema,
    activityHistoryResponseSchema,
} from "@/schemas/activity";

const logger = new Logger("activity-history");

const getActivityHistoryRoute = createRoute({
    method: "get",
    tags: ["user"],
    path: "/history",
    summary: "Get activity bonus history",
    description:
        "Retrieve historical activity bonus claims with pagination and filters",
    request: {
        cookies: authCookie,
        query: activityHistoryQuerySchema,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: activityHistoryResponseSchema,
                },
            },
            description: "Successfully retrieved activity history",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

export const activityHistoryRoutes = (app: OpenAPIHono) => {
    app.openapi(getActivityHistoryRoute, async (c) => {
        try {
            const user = c.get("user");
            const { page, limit, type } = c.req.valid("query");

            const skip = (page - 1) * limit;

            const whereClause: any = {
                userId: user.id,
                status: "COLLECTED",
            };

            if (type) {
                whereClause.type = type;
            }

            const [bonuses, total] = await Promise.all([
                prisma.activityBonus.findMany({
                    where: whereClause,
                    orderBy: { claimAt: "desc" },
                    take: limit,
                    skip,
                }),
                prisma.activityBonus.count({ where: whereClause }),
            ]);

            const totalPages = Math.ceil(total / limit);

            return c.json(
                {
                    success: true,
                    data: bonuses.map((bonus) => ({
                        id: bonus.id,
                        userId: bonus.userId,
                        type: bonus.type,
                        status: bonus.status,
                        amount: bonus.amount,
                        metadata: bonus.metadata,
                        expiresAt: bonus.expiresAt?.toISOString(),
                        claimAt: bonus.claimAt?.toISOString(),
                        createdAt: bonus.createdAt.toISOString(),
                        updatedAt: bonus.updatedAt.toISOString(),
                    })),
                    total,
                    currentPage: page,
                    totalPages,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error fetching activity history:", error);
            return apiError(
                c,
                "Failed to fetch activity history",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
