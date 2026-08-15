// import { OpenAPIHono, z } from "@hono/zod-openapi";
// import { createRoute } from "@hono/zod-openapi";

// import { apiError, CommonResponses } from "@/lib/utils";
// import Greytop from "@/lib/vendor/greytop";
// import { HTTP_STATUS } from "@/lib/http";
// import { authCookie } from "@/schemas";
// import Logger from "@bcwin/logger";

// const logger = new Logger("admin-update-greytop-games");

// const ResponseSchema = z.object({
//     success: z.boolean().openapi({
//         description:
//             "Whether the gretop games were fetched and updated in database successfully",
//         example: true,
//     }),
// });

// const updateGreytopGamesRoute = createRoute({
//     method: "get",
//     path: "/update-greytop-games",
//     tags: ["admin"],
//     summary: "Update greytop games",
//     description: "Update greytop games",
//     request: {
//         cookies: authCookie,
//     },
//     responses: {
//         200: {
//             content: {
//                 "application/json": {
//                     schema: ResponseSchema,
//                 },
//             },
//             description: "Update greytop games",
//         },
//         ...CommonResponses.badRequest(),
//         ...CommonResponses.internalServerError(),
//     },
// });

// export const updateGreytopGamesRoutes = (app: OpenAPIHono) => {
//     app.openapi(updateGreytopGamesRoute, async (c) => {
//         try {
//             await Greytop.getGames();

//             return c.json(
//                 {
//                     success: true,
//                 },
//                 HTTP_STATUS.OK
//             );
//         } catch (error) {
//             logger.error(error);
//             return apiError(
//                 c,
//                 "Internal server error",
//                 HTTP_STATUS.INTERNAL_SERVER_ERROR
//             );
//         }
//     });
// };
