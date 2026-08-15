// import { OpenAPIHono, z } from "@hono/zod-openapi";
// import { createRoute } from "@hono/zod-openapi";

// import Logger from "@bcwin/logger";
// import { HTTP_STATUS } from "@/lib/http";
// import { apiError, CommonResponses } from "@/lib/utils";
// import { authCookie } from "@/schemas";
// import Greytop from "@/lib/vendor/greytop";

// const logger = new Logger("greytop-launch");

// const launchRequestSchema = z.object({
//     UID: z.string().openapi({
//         description: "Game UID",
//         example: "562b299961b0ec40f252a832453c67b0",
//     }),
// });

// const launchResponseSchema = z.object({
//     success: z.boolean().openapi({
//         description: "Whether the game was launched successfully",
//         example: true,
//     }),
//     gameUrl: z.string().openapi({
//         description: "Game URL",
//         example: "https://www.greytop.com/game/chicken-road",
//     }),
// });

// const launchRoute = createRoute({
//     method: "post",
//     tags: ["greytop"],
//     path: "/launch",
//     summary: "Launch Greytop game",
//     description: "Launch Greytop Game by providing the game UID",
//     request: {
//         cookies: authCookie,
//         body: {
//             content: {
//                 "application/json": {
//                     schema: launchRequestSchema,
//                 },
//             },
//         },
//     },
//     responses: {
//         200: {
//             content: {
//                 "application/json": {
//                     schema: launchResponseSchema,
//                 },
//             },
//             description: "Game launched successfully",
//         },
//         ...CommonResponses.badRequest(),
//         ...CommonResponses.unauthorized(),
//         ...CommonResponses.internalServerError(),
//     },
// });

// export const launchRoutes = (app: OpenAPIHono) => {
//     app.openapi(launchRoute, async (c) => {
//         try {
//             const user = c.get("user");
//             const { UID } = c.req.valid("json");

//             const result = await Greytop.launch(
//                 user.username,
//                 UID,
//                 user.balance
//             );

//             if (!result.success) {
//                 return apiError(c, result.error, HTTP_STATUS.BAD_REQUEST);
//             }

//             return c.json(
//                 {
//                     success: true,
//                     gameUrl: result.data.data.payload.game_launch_url,
//                 },
//                 HTTP_STATUS.OK
//             );
//         } catch (error) {
//             logger.error("Error launching game:", error);
//             return apiError(
//                 c,
//                 "Failed to launch game",
//                 HTTP_STATUS.INTERNAL_SERVER_ERROR
//             );
//         }
//     });
// };
