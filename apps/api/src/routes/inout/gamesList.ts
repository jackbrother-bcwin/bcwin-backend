import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import {
    inoutGamesListQuerySchema,
    inoutGamesListResponseSchema,
    inoutGameCategorySchema
} from "@/schemas/inout";
import { Cache, CacheKey } from "@bcwin/cache";

const logger = new Logger("inout-games-list");

type InoutGameCategory = z.infer<typeof inoutGameCategorySchema>;
const BonusTypesSchema = z.array(z.string());

const getInoutGamesRoute = createRoute({
    method: "get",
    tags: ["inout"],
    path: "/games",
    summary: "Get Inout games list",
    description:
        "Retrieve list of Inout games with pagination and category filter",
    request: {
        query: inoutGamesListQuerySchema,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: inoutGamesListResponseSchema,
                },
            },
            description: "Successfully retrieved games list",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

export const gamesListRoutes = (app: OpenAPIHono) => {
    app.openapi(getInoutGamesRoute, async (c) => {
        try {
            const { page, limit, category, search } =
                c.req.valid("query");

            const skip = (page - 1) * limit;

            // Check cache using hash-based caching
            const mainCacheKey = CacheKey.inoutGames;
            const fieldKey = `category:${category || "all"}-search:${search || "all"
                }-page:${page}-limit:${limit}`;

            const cachedData = await Cache.hget<{
                data: Array<{
                    id: string;
                    title: string;
                    gameMode: string;
                    description: string;
                    icon: string;
                    category: InoutGameCategory;
                    multiplayer: boolean;
                    rtp: number;
                    bonusTypes: string[];
                    createdAt: string;
                    updatedAt: string;
                }>;
                total: number;
                currentPage: number;
                totalPages: number;
            }>(mainCacheKey, fieldKey);

            if (cachedData) {
                return c.json(
                    {
                        success: true,
                        ...cachedData,
                    },
                    HTTP_STATUS.OK
                );
            }

            const whereClause: any = {};

            // Filter by category
            if (category) {
                whereClause.category = {
                    contains: category,
                    mode: "insensitive"
                };
            }

            // Search by game title
            if (search) {
                whereClause.title = {
                    contains: search,
                    mode: "insensitive",
                };
            }

            const [games, total] = await Promise.all([
                prisma.inoutGame.findMany({
                    where: whereClause,
                    orderBy: { title: "asc" },
                    take: limit,
                    skip,
                }),
                prisma.inoutGame.count({ where: whereClause }),
            ]);

            const totalPages = Math.ceil(total / limit);

            const result = {
                data: games.map((game) => ({
                    id: game.id,
                    title: game.title,
                    gameMode: game.gameMode,
                    description: game.description,
                    icon: game.icon,
                    category: game.category as unknown as InoutGameCategory,
                    multiplayer: game.multiplayer,
                    rtp: game.rtp,
                    bonusTypes: BonusTypesSchema.parse(game.bonusTypes),
                    createdAt: game.createdAt.toISOString(),
                    updatedAt: game.updatedAt.toISOString(),
                })),
                total,
                currentPage: page,
                totalPages,
            };

            // Cache for 1 hour - games list doesn't change frequently
            await Cache.hset(mainCacheKey, fieldKey, result, 60 * 60);

            return c.json(
                {
                    success: true,
                    ...result,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error fetching inout games:", error);
            return apiError(
                c,
                "Failed to fetch inout games",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
