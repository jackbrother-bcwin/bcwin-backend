import { createRoute, RouteConfig, OpenAPIHono, z } from "@hono/zod-openapi";
import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { apiError, CommonResponses } from "@/lib/utils";
import { HTTP_STATUS } from "@/lib/http";
import { authCookie, limit, page } from "@/schemas";
import { Cache, CacheKey } from "@bcwin/cache";

const logger = new Logger("admin-illegal-bets");

const createAdminRoute = <T extends RouteConfig>(config: T) => {
    return createRoute({
        tags: ["admin"],
        ...config,
    });
};

const GetIllegalBetsSchema = z.object({
    page,
    limit,
    userId: z.string().optional().openapi({
        description: "Filter by user ID",
        example: "123",
    }),
    startDate: z.string().optional().openapi({
        description: "Filter by start date (ISO 8601 format)",
        example: "2025-01-01T00:00:00Z",
    }),
    endDate: z.string().optional().openapi({
        description: "Filter by end date (ISO 8601 format)",
        example: "2025-01-31T23:59:59Z",
    }),
    minBetAmount: z.string().optional().openapi({
        description: "Filter by minimum bet amount",
        example: "100",
    }),
    serialNumber: z.string().optional().openapi({
        description: "Filter by user serial number",
        example: "12345",
    }),
});

const illegalBetSchema = z.object({
    id: z.string().openapi({
        description: "The unique identifier of the illegal bet",
        example: "clxyz123abc456",
    }),
    userSerialNumber: z.number().openapi({
        description: "The serial number of the user who placed the bet",
        example: 123456,
    }),
    userId: z.string().openapi({
        description: "The ID of the user who placed the bet",
        example: "usr_abc123",
    }),
    username: z.string().optional().openapi({
        description: "The username of the user who placed the bet",
        example: "john_doe",
    }),
    betAmount: z.number().openapi({
        description: "The amount of the bet",
        example: 1000,
    }),
    betGame: z.string().openapi({
        description: "The game on which the bet was placed",
        example: "roulette",
    }),
    betType: z.string().openapi({
        description: "The type of the bet",
        example: "red",
    }),
    createdAt: z.string().openapi({
        description: "The date and time when the bet was created",
        example: "2025-11-29T10:30:00Z",
    }),
});

const illegalBetsResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the illegal bets were fetched successfully",
        example: true,
    }),
    data: z.array(illegalBetSchema).openapi({
        description: "Array of illegal bets",
    }),
    total: z.number().openapi({
        description: "Total number of illegal bets matching the query",
        example: 42,
    }),
    currentPage: z.number().openapi({
        description: "Current page number",
        example: 1,
    }),
    totalPages: z.number().openapi({
        description: "Total number of pages",
        example: 5,
    }),
});

const GetIllegalBetsRoute = createAdminRoute({
    method: "get",
    path: "/",
    summary: "Get illegal bets",
    description: "Get a list of detected illegal bets (hedging)",
    request: {
        cookies: authCookie,
        query: GetIllegalBetsSchema,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: illegalBetsResponseSchema,
                },
            },
            description: "Illegal bets retrieved successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

type IllegalBetsData = z.infer<typeof illegalBetsResponseSchema>;

export const illegalBetsRoutes = (app: OpenAPIHono) => {
    app.openapi(GetIllegalBetsRoute, async (c) => {
        try {
            const {
                page,
                limit,
                userId,
                startDate,
                endDate,
                minBetAmount,
                serialNumber,
            } = c.req.valid("query");
            const skip = (page - 1) * limit;

            // Check cache using hash-based caching
            const fieldKey = `page:${page}-limit:${limit}-userId:${
                userId || "all"
            }-start:${startDate || "none"}-end:${endDate || "none"}-minBet:${
                minBetAmount || "none"
            }-serial:${serialNumber || "none"}`;

            const cachedData = await Cache.hget<IllegalBetsData>(
                CacheKey.illegalBets,
                fieldKey
            );

            if (cachedData) {
                return c.json(
                    {
                        ...cachedData,
                        success: true,
                    },
                    HTTP_STATUS.OK
                );
            }

            // Build where clause with filters
            const where: any = {};

            if (userId) {
                where.userId = userId;
            }

            if (startDate || endDate) {
                where.createdAt = {};
                if (startDate) {
                    where.createdAt.gte = new Date(startDate);
                }
                if (endDate) {
                    where.createdAt.lte = new Date(endDate);
                }
            }

            if (minBetAmount) {
                where.betAmount = {
                    gte: parseFloat(minBetAmount),
                };
            }

            if (serialNumber) {
                where.user = {
                    serialNumber: parseInt(serialNumber, 10),
                };
            }

            const [illegalBets, total] = await Promise.all([
                prisma.illegalBet.findMany({
                    where,
                    take: limit,
                    skip,
                    include: {
                        user: {
                            select: {
                                username: true,
                                serialNumber: true,
                            },
                        },
                    },
                    orderBy: {
                        createdAt: "desc",
                    },
                }),
                prisma.illegalBet.count({ where }),
            ]);

            const totalPages = Math.ceil(total / limit);

            const formattedBets = illegalBets.map((bet) => ({
                id: bet.id,
                userId: bet.userId,
                userSerialNumber: bet.user.serialNumber,
                username: bet.user.username,
                betAmount: bet.betAmount,
                betGame: bet.betGame,
                betType: bet.betType,
                createdAt: bet.createdAt.toISOString(),
            }));

            const result: IllegalBetsData = {
                success: true,
                data: formattedBets,
                total,
                currentPage: page,
                totalPages,
            };

            await Cache.hset(
                CacheKey.illegalBets,
                fieldKey,
                result,
                60 * 2 // 2 minutes
            );

            return c.json(result, HTTP_STATUS.OK);
        } catch (error) {
            logger.error("Error fetching illegal bets:", error);
            return apiError(
                c,
                "Internal server error",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
