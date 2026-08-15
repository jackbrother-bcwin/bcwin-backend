// import { OpenAPIHono, z } from "@hono/zod-openapi";
// import { createRoute } from "@hono/zod-openapi";

// import { prisma } from "@bcwin/db";
// import Logger from "@bcwin/logger";
// import { HTTP_STATUS } from "@/lib/http";
// import { apiError, CommonResponses } from "@/lib/utils";
// import { authCookie, page } from "@/schemas";
// import { Cache, CacheKey } from "@bcwin/cache";

// const logger = new Logger("greytop-bets");

// const greytopBetResponseSchema = z.object({
//     id: z.uuid().openapi({
//         description: "Bet ID",
//         example: "147f8c93-b8c2-4435-8534-9ac4ad282ca5",
//     }),
//     serialNumber: z.string().openapi({
//         description: "Serial number",
//         example: "1234567890",
//     }),
//     currencyCode: z.string().openapi({
//         description: "Currency code",
//         example: "INR",
//     }),
//     gameUid: z.string().openapi({
//         description: "Game UID",
//         example: "562b299961b0ec40f252a832453c67b0",
//     }),
//     gameName: z.string().openapi({
//         description: "Game name",
//         example: "CHICKEN_ROAD",
//     }),
//     winAmount: z.number().openapi({
//         description: "Win amount",
//         example: 588,
//     }),
//     betAmount: z.number().openapi({
//         description: "Original bet amount",
//         example: 100,
//     }),
//     timestamp: z.string().openapi({
//         description: "Timestamp",
//         example: "2024-01-01T15:00:30Z",
//     }),
//     gameRound: z.string().openapi({
//         description: "Game round",
//         example: "123456",
//     }),
//     createdAt: z.string().openapi({
//         description: "Bet creation time",
//         example: "2024-01-01T15:00:30Z",
//     }),
// });

// const userBetsResponseSchema = z.object({
//     success: z.boolean().openapi({
//         description: "Whether the bets were fetched successfully",
//         example: true,
//     }),
//     bets: z.array(greytopBetResponseSchema).openapi({
//         description: "List of user bets",
//     }),
//     total: z.number().openapi({
//         description: "Total number of bets",
//         example: 50,
//     }),
// });

// const greytopUserBetsRequestSchema = z.object({
//     limit: z.coerce.number().min(1).max(100).optional().default(20).openapi({
//         description: "Number of bets to fetch",
//         example: 20,
//     }),
//     page,
// });

// const getUserBetsRoute = createRoute({
//     method: "get",
//     tags: ["greytop"],
//     path: "/bets",
//     request: {
//         cookies: authCookie,
//         query: greytopUserBetsRequestSchema,
//     },
//     responses: {
//         200: {
//             content: {
//                 "application/json": {
//                     schema: userBetsResponseSchema,
//                 },
//             },
//             description: "Get user bets",
//         },
//         ...CommonResponses.badRequest(),
//         ...CommonResponses.unauthorized(),
//         ...CommonResponses.internalServerError(),
//     },
// });

// export const betRoutes = (app: OpenAPIHono) => {
//     app.openapi(getUserBetsRoute, async (c) => {
//         try {
//             const user = c.get("user");
//             const { limit, page } = c.req.valid("query");
//             const skip = (page - 1) * limit;

//             const whereClause: any = { userId: user.id };

//             // Cache key strategy needs to be adapted for greytop if needed,
//             // assuming CacheKey has a method or we use a string.
//             // Since I don't see CacheKey definition, I'll assume a pattern or avoid using CacheKey helper if it doesn't support greytop yet.
//             // But better to be safe and use a string key if unsure.
//             // user.id is unique.
//             const mainCacheKey = CacheKey.greytopBets(user.id);
//             const fieldKey = `l:${limit}-page:${page}`;

//             const cachedData = await Cache.hget<
//                 Pick<z.infer<typeof userBetsResponseSchema>, "bets" | "total">
//             >(mainCacheKey, fieldKey);

//             if (cachedData) {
//                 return c.json(
//                     {
//                         success: true,
//                         ...cachedData,
//                     },
//                     HTTP_STATUS.OK
//                 );
//             }

//             const [bets, total] = await Promise.all([
//                 prisma.greytopBet.findMany({
//                     where: whereClause,
//                     orderBy: { createdAt: "desc" },
//                     take: limit,
//                     skip,
//                 }),
//                 prisma.greytopBet.count({ where: whereClause }),
//             ]);

//             const result = {
//                 bets: bets.map((bet) => ({
//                     id: bet.id,
//                     serialNumber: bet.serialNumber,
//                     currencyCode: bet.currencyCode,
//                     gameUid: bet.gameUid,
//                     gameName: bet.gameName,
//                     winAmount: bet.winAmount,
//                     betAmount: bet.betAmount,
//                     timestamp: bet.timestamp,
//                     gameRound: bet.gameRound,
//                     createdAt: bet.createdAt.toISOString(),
//                 })),
//                 total,
//             };

//             await Cache.hset(mainCacheKey, fieldKey, result, 60 * 60);

//             return c.json(
//                 {
//                     success: true,
//                     bets: result.bets,
//                     total: result.total,
//                 },
//                 HTTP_STATUS.OK
//             );
//         } catch (error) {
//             logger.error("Error fetching user bets:", error);
//             return apiError(
//                 c,
//                 "Failed to fetch bets",
//                 HTTP_STATUS.INTERNAL_SERVER_ERROR
//             );
//         }
//     });
// };
