// import { OpenAPIHono, z } from "@hono/zod-openapi";
// import { createRoute } from "@hono/zod-openapi";

// import Logger from "@bcwin/logger";
// import { HTTP_STATUS } from "@/lib/http";
// import { apiError, CommonResponses } from "@/lib/utils";
// import { prisma } from "@bcwin/db";
// import { WebSocketManager } from "@bcwin/websocket";
// import Greytop from "@/lib/vendor/greytop";
// import { RebateCalculator } from "@bcwin/rebate";
// import {
//     checkAndCreateWeeklyBonuses,
//     checkAndCreateDailyBonuses,
// } from "@bcwin/activity-bonus";

// const logger = new Logger("callback-vendor-greytop");

// const SUCCESS_RETURN = "success";

// const GreytopDataSchema = z.object({
//     timestamp: z.string(),
//     payload: z.string(),
// });

// const greytopCallbackRoute = createRoute({
//     method: "post",
//     path: "/greytop",
//     tags: ["callback"],
//     summary: "Greytop callback",
//     description: "Greytop callback. Used for callback data from greytop.",
//     request: {
//         body: {
//             content: {
//                 "application/json": {
//                     schema: GreytopDataSchema,
//                 },
//             },
//         },
//     },
//     responses: {
//         200: {
//             content: {
//                 "text/plain": {
//                     schema: z.enum([SUCCESS_RETURN]),
//                 },
//             },
//             description: "Greytop callback",
//         },
//         ...CommonResponses.internalServerError(),
//     },
// });

// export const greytopCallbackRoutes = (app: OpenAPIHono) => {
//     app.openapi(greytopCallbackRoute, async (c) => {
//         try {
//             const encryptedData = c.req.valid("json");

//             logger.debug("GREYTOP_CALLBACK", encryptedData);
//             const data = Greytop.decrypt(encryptedData.payload);
//             logger.debug("GREYTOP_CALLBACK_NORMALIZED_DECRYPTED", data);

//             const { name, type } = await Greytop.getGameNameAndType(
//                 data.game_uid
//             );

//             await prisma.greytopBet.create({
//                 data: {
//                     user: {
//                         connect: {
//                             username: data.member_account,
//                         },
//                     },
//                     serialNumber: data.serial_number,
//                     currencyCode: data.currency_code,
//                     gameUid: data.game_uid,
//                     winAmount: data.win_amount,
//                     gameName: name,
//                     gameType: type,
//                     betAmount: data.bet_amount,
//                     timestamp: data.timestamp,
//                     gameRound: data.game_round,
//                 },
//             });

//             // handle bet
//             if (data.bet_amount > 0) {
//                 const updatedUser = await prisma.user.update({
//                     where: {
//                         username: data.member_account,
//                     },
//                     data: {
//                         balance: {
//                             decrement: data.bet_amount,
//                         },
//                     },
//                     select: {
//                         id: true,
//                         balance: true,
//                     },
//                 });

//                 WebSocketManager.publishToUser(
//                     updatedUser.id,
//                     "account-balance",
//                     { balance: updatedUser.balance }
//                 );

//                 // Calculate rebate for this bet (async, non-blocking)
//                 RebateCalculator.calculateRebateForBet(
//                     updatedUser.id,
//                     data.bet_amount,
//                     "GREYTOP"
//                 ).catch((err) =>
//                     logger.error("Error calculating rebate:", err)
//                 );

//                 // Fire-and-forget: Check activity bonuses
//                 checkAndCreateWeeklyBonuses(updatedUser.id);
//                 checkAndCreateDailyBonuses(updatedUser.id);
//             }

//             // handle win
//             if (data.win_amount > 0) {
//                 const updatedUser = await prisma.user.update({
//                     where: {
//                         username: data.member_account,
//                     },
//                     data: {
//                         balance: {
//                             increment: data.win_amount,
//                         },
//                     },
//                     select: {
//                         id: true,
//                         balance: true,
//                     },
//                 });

//                 WebSocketManager.publishToUser(
//                     updatedUser.id,
//                     "account-balance",
//                     { balance: updatedUser.balance }
//                 );
//             }

//             return c.text(SUCCESS_RETURN, HTTP_STATUS.OK);
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
