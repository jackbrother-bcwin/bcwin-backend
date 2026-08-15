import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie, BanUserResponseSchema } from "@/schemas";
import { prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";

const logger = new Logger("admin-users-unban");

const unbanUserRoute = createRoute({
    method: "post",
    path: "/:id/unban",
    tags: ["admin"],
    summary: "Unban user",
    description: "Unban a user account",
    request: {
        params: z.object({
            id: z.string().openapi({
                description: "User ID",
                example: "uuid-123",
            }),
        }),
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: BanUserResponseSchema,
                },
            },
            description: "User unbanned successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

export const unbanRoutes = (app: OpenAPIHono) => {
    app.openapi(unbanUserRoute, async (c) => {
        try {
            const { id } = c.req.valid("param");

            const user = await prisma.user.findUnique({
                where: { id },
            });

            if (!user) {
                return apiError(c, "User not found", HTTP_STATUS.BAD_REQUEST);
            }

            if (!user.isBanned) {
                return apiError(
                    c,
                    "User is not banned",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            await prisma.user.update({
                where: { id },
                data: { isBanned: false },
            });

            logger.info(`User ${id} unbanned`);

            // Invalidate caches
            await Promise.all([
                Cache.del(CacheKey.adminUserStats(id)),
                Cache.del(CacheKey.adminUsers),
            ]);

            return c.json(
                {
                    success: true,
                    message: "User unbanned successfully",
                },
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
};
