import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import { apiError, CommonResponses } from "@/lib/utils";
import Inout from "@/lib/vendor/inout";
import { HTTP_STATUS } from "@/lib/http";
import { authCookie } from "@/schemas";
import { Cache, CacheKey } from "@bcwin/cache";
import Logger from "@bcwin/logger";

const logger = new Logger("admin-update-inout-games");

const ResponseSchema = z.object({
    success: z.boolean().openapi({
        description:
            "Whether the inout games were fetched and updated in database successfully",
        example: true,
    }),
});

const updateInoutGamesRoute = createRoute({
    method: "get",
    path: "/update-inout-games",
    tags: ["admin"],
    summary: "Update inout games",
    description: "Update inout games",
    request: {
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: ResponseSchema,
                },
            },
            description: "Update inout games",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

export const updateInoutGamesRoutes = (app: OpenAPIHono) => {
    app.openapi(updateInoutGamesRoute, async (c) => {
        try {
            await Inout.getGames();
            await Cache.del(CacheKey.inoutGames);

            return c.json(
                {
                    success: true,
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
