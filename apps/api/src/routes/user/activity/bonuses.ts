import { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import {
    activityBonusListQuerySchema,
    activityBonusListResponseSchema,
} from "@/schemas/activity";

const logger = new Logger("activity-bonuses");

const getActivityBonusesRoute = createRoute({
    method: "get",
    tags: ["user"],
    path: "/bonuses",
    summary: "Get activity bonuses",
    description:
        "List user's activity bonuses with pagination and filters (type, status)",
    request: {
        cookies: authCookie,
        query: activityBonusListQuerySchema,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: activityBonusListResponseSchema,
                },
            },
            description: "Successfully retrieved activity bonuses",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

export const activityBonusesRoutes = (app: OpenAPIHono) => {
    app.openapi(getActivityBonusesRoute, async (c) => {
        try {
            const user = c.get("user");
            const { page, limit, type, status } = c.req.valid("query");

            const skip = (page - 1) * limit;

            const whereClause: any = {
                userId: user.id,
            };

            if (type) {
                whereClause.type = type;
            }

            if (status) {
                whereClause.status = status;
            }

            const [bonuses, total] = await Promise.all([
                prisma.activityBonus.findMany({
                    where: whereClause,
                    orderBy: { createdAt: "desc" },
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
            logger.error("Error fetching activity bonuses:", error);
            return apiError(
                c,
                "Failed to fetch activity bonuses",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
