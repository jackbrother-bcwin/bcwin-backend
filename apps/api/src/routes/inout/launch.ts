import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import Inout from "@/lib/vendor/inout";
import { requireLifetimeDeposit } from "@/lib/gameDepositGate";

const logger = new Logger("inout-launch");

const launchRequestSchema = z.object({
    gameMode: z.string().openapi({
        description: "game id",
        example: "plinko",
    }),
});

const launchResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the game was launched successfully",
        example: true,
    }),
    gameUrl: z.string().openapi({
        description: "Game URL",
        example: "https://www.inout.com/game/chicken-road",
    }),
});

const launchRoute = createRoute({
    method: "post",
    tags: ["inout"],
    path: "/launch",
    summary: "Launch Inout game",
    description: "Launch Inout Game by providing the gameMode (game id)",
    request: {
        cookies: authCookie,
        body: {
            content: {
                "application/json": {
                    schema: launchRequestSchema,
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: launchResponseSchema,
                },
            },
            description: "Game launched successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

export const launchRoutes = (app: OpenAPIHono) => {
    app.openapi(launchRoute, async (c) => {
        try {
            const user = c.get("user");
            const { gameMode } = c.req.valid("json");

            if (user.isDemo) {
                return apiError(
                    c,
                    "Demo accounts cannot play third-party games",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            const depositGate = await requireLifetimeDeposit(user);
            if (!depositGate.ok) {
                return apiError(
                    c,
                    depositGate.message,
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            const result = await Inout.launch(
                gameMode,
                user.id
            );

            if (!result.success || !result.data) {
                return apiError(c, result.error!, HTTP_STATUS.BAD_REQUEST);
            }

            return c.json(
                {
                    success: true,
                    gameUrl: result.data,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error launching game:", error);
            return apiError(
                c,
                "Failed to launch game",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
