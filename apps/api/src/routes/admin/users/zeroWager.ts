import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import Logger from "@bcwin/logger";
import { authCookie } from "@/schemas";
import { apiError, CommonResponses } from "@/lib/utils";
import { HTTP_STATUS } from "@/lib/http";

const logger = new Logger("admin-users-zero-wager");
const route = createRoute({
    method: "post",
    path: "/:id/zero-wager",
    tags: ["admin"],
    summary: "Enable or disable one-use zero wager",
    request: {
        params: z.object({ id: z.string() }),
        cookies: authCookie,
        body: { content: { "application/json": {
            schema: z.object({ zeroWagerEnabled: z.boolean() }),
        } } },
    },
    responses: {
        200: {
            description: "Zero wager updated",
            content: { "application/json": { schema: z.object({
                success: z.boolean(),
                user: z.object({ id: z.string(), zeroWagerEnabled: z.boolean() }),
            }) } },
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

export const zeroWagerRoutes = (app: OpenAPIHono) => {
    app.openapi(route, async (c) => {
        try {
            const { id } = c.req.valid("param");
            const { zeroWagerEnabled } = c.req.valid("json");
            const exists = await prisma.user.findUnique({ where: { id }, select: { id: true } });
            if (!exists) return apiError(c, "User not found", HTTP_STATUS.BAD_REQUEST);
            const user = await prisma.user.update({
                where: { id },
                data: { zeroWagerEnabled },
                select: { id: true, zeroWagerEnabled: true },
            });
            await Cache.del(CacheKey.adminUserStats(id));
            logger.info(`User ${id} zero wager enabled: ${zeroWagerEnabled}`);
            return c.json({ success: true, user }, HTTP_STATUS.OK);
        } catch (error) {
            logger.error(error);
            return apiError(c, "Internal server error", HTTP_STATUS.INTERNAL_SERVER_ERROR);
        }
    });
};
