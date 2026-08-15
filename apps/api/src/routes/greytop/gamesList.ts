// import { OpenAPIHono } from "@hono/zod-openapi";
// import { createRoute } from "@hono/zod-openapi";

// import { prisma, GreytopGameType } from "@bcwin/db";
// import Logger from "@bcwin/logger";
// import { HTTP_STATUS } from "@/lib/http";
// import { apiError, CommonResponses } from "@/lib/utils";
// import {
//     greytopGamesListQuerySchema,
//     greytopGamesListResponseSchema,
// } from "@/schemas/greytop";
// import { Cache, CacheKey } from "@bcwin/cache";

// const logger = new Logger("greytop-games-list");

// const getGreytopGamesRoute = createRoute({
//     method: "get",
//     tags: ["greytop"],
//     path: "/games",
//     summary: "Get Greytop games list",
//     description:
//         "Retrieve list of Greytop games with pagination and filters (type, provider, search)",
//     request: {
//         query: greytopGamesListQuerySchema,
//     },
//     responses: {
//         200: {
//             content: {
//                 "application/json": {
//                     schema: greytopGamesListResponseSchema,
//                 },
//             },
//             description: "Successfully retrieved games list",
//         },
//         ...CommonResponses.badRequest(),
//         ...CommonResponses.internalServerError(),
//     },
// });

// export const gamesListRoutes = (app: OpenAPIHono) => {
//     app.openapi(getGreytopGamesRoute, async (c) => {
//         try {
//             const { page, limit, type, providerCode, providerName, search } =
//                 c.req.valid("query");

//             const skip = (page - 1) * limit;

//             // Check cache using hash-based caching
//             const mainCacheKey = CacheKey.greytopGames;
//             const fieldKey = `type:${type || "all"}-provider:${
//                 providerCode || "all"
//             }-providerName:${providerName || "all"}-search:${
//                 search || "all"
//             }-page:${page}-limit:${limit}`;

//             const cachedData = await Cache.hget<{
//                 data: Array<{
//                     id: string;
//                     name: string;
//                     uid: string;
//                     providerName: string;
//                     providerCode: string;
//                     type: GreytopGameType[];
//                     createdAt: string;
//                     updatedAt: string;
//                 }>;
//                 total: number;
//                 currentPage: number;
//                 totalPages: number;
//             }>(mainCacheKey, fieldKey);

//             if (cachedData) {
//                 return c.json(
//                     {
//                         success: true,
//                         ...cachedData,
//                     },
//                     HTTP_STATUS.OK
//                 );
//             }

//             const whereClause: any = {};

//             // Filter by type (game can have multiple types)
//             if (type) {
//                 whereClause.type = {
//                     has: type,
//                 };
//             }

//             // Filter by provider code
//             if (providerCode) {
//                 whereClause.providerCode = providerCode;
//             }

//             // Filter by provider name
//             if (providerName) {
//                 whereClause.providerName = {
//                     contains: providerName,
//                     mode: "insensitive",
//                 };
//             }

//             // Search by game name
//             if (search) {
//                 whereClause.name = {
//                     contains: search,
//                     mode: "insensitive",
//                 };
//             }

//             const [games, total] = await Promise.all([
//                 prisma.greytopGame.findMany({
//                     where: whereClause,
//                     orderBy: { name: "asc" },
//                     take: limit,
//                     skip,
//                 }),
//                 prisma.greytopGame.count({ where: whereClause }),
//             ]);

//             const totalPages = Math.ceil(total / limit);

//             const result = {
//                 data: games.map((game) => ({
//                     id: game.id,
//                     name: game.name,
//                     uid: game.uid,
//                     providerName: game.providerName,
//                     providerCode: game.providerCode,
//                     type: game.type as GreytopGameType[],
//                     createdAt: game.createdAt.toISOString(),
//                     updatedAt: game.updatedAt.toISOString(),
//                 })),
//                 total,
//                 currentPage: page,
//                 totalPages,
//             };

//             // Cache for 1 hour - games list doesn't change frequently
//             await Cache.hset(mainCacheKey, fieldKey, result, 60 * 60);

//             return c.json(
//                 {
//                     success: true,
//                     ...result,
//                 },
//                 HTTP_STATUS.OK
//             );
//         } catch (error) {
//             logger.error("Error fetching greytop games:", error);
//             return apiError(
//                 c,
//                 "Failed to fetch greytop games",
//                 HTTP_STATUS.INTERNAL_SERVER_ERROR
//             );
//         }
//     });
// };
