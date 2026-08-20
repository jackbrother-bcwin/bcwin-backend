import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie, limit, page } from "@/schemas";
import { prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import {
    ADMIN_USER_IDENTITY_SELECT,
    mapAdminUserIdentity,
} from "@/lib/adminUserIdentity";
import { wingoGameName } from "@/lib/lotteryDuration";

const logger = new Logger("admin-game-history");

// Query schema
const GetGameHistoryQuerySchema = z.object({
    page,
    limit,
    gameName: z.string().optional().openapi({
        description: "Filter by game name (partial match)",
        example: "Wingo",
    }),
    wins: z.enum(["true", "false"]).optional().openapi({
        description: "Filter by wins (true) or losses (false)",
        example: "true",
    }),
    userId: z.string().optional().openapi({
        description: "Filter by user ID",
        example: "user-123",
    }),
});

// Bet item schema
const GameHistoryItemSchema = z.object({
    id: z.string().openapi({
        description: "Bet ID",
        example: "uuid-123",
    }),
    majorGameType: z
        .enum(["WINGO", "FIVE_D", "K3", "MOTO", "TRX_WINGO", "INOUT"])
        .openapi({
            description: "Major game type",
            example: "WINGO",
        }),
    gameName: z.string().openapi({
        description: "Game name",
        example: "Wingo 1Min",
    }),
    betAmount: z.number().openapi({
        description: "Bet amount",
        example: 100,
    }),
    winAmount: z.number().openapi({
        description: "Win amount (0 if lost)",
        example: 200,
    }),
    status: z.string().openapi({
        description: "Bet status",
        example: "WON",
    }),
    user: z.object({
        id: z.string().openapi({
            description: "User ID",
            example: "user-123",
        }),
        serialNumber: z.number().openapi({
            description: "User serial number",
            example: 8400,
        }),
        username: z.string().openapi({
            description: "Username",
            example: "user123",
        }),
        mobileNumber: z.string().openapi({
            description: "User mobile number",
            example: "9876543210",
        }),
        email: z.string().nullable().optional(),
        bank: z
            .object({ fullName: z.string().nullable() })
            .nullable()
            .optional(),
    }),
    createdAt: z.string().openapi({
        description: "Creation timestamp",
        example: "2025-01-12T10:30:00Z",
    }),
    metadata: z.record(z.string(), z.any()).optional().openapi({
        description: "Additional game-specific metadata",
    }),
});

// Response schema
const GetGameHistoryResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    bets: z.array(GameHistoryItemSchema),
    total: z.number().openapi({
        description: "Total number of bets",
        example: 100,
    }),
    currentPage: z.number().openapi({
        description: "Current page number",
        example: 1,
    }),
    totalPages: z.number().openapi({
        description: "Total number of pages",
        example: 4,
    }),
});

const getGameHistoryRoute = createRoute({
    method: "get",
    path: "/game-history",
    tags: ["admin"],
    summary: "List game history",
    description:
        "Get a paginated list of all bets placed on all games with optional filtering by game name, wins/losses and userId",
    request: {
        query: GetGameHistoryQuerySchema,
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: GetGameHistoryResponseSchema,
                },
            },
            description: "List of game history bets",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

export const gameHistoryRoutes = (app: OpenAPIHono) => {
    app.openapi(getGameHistoryRoute, async (c) => {
        try {
            const { page, limit, gameName, wins, userId } =
                c.req.valid("query");

            const skip = (page - 1) * limit;

            // Check cache using hash-based caching
            const mainCacheKey = CacheKey.adminGameHistory;
            const fieldKey = `v4-gameName:${gameName || "all"}-wins:${wins || "all"
                }-userId:${userId || "all"
                }-page:${page}-limit:${limit}`;

            const cachedData = await Cache.hget<{
                bets: Array<{
                    id: string;
                    majorGameType:
                    | "WINGO"
                    | "FIVE_D"
                    | "K3"
                    | "MOTO"
                    | "TRX_WINGO"
                    gameName: string;
                    betAmount: number;
                    winAmount: number;
                    status: string;
                    user: {
                        id: string;
                        serialNumber: number;
                        username: string;
                        mobileNumber: string;
                    };
                    createdAt: string;
                    metadata?: Record<string, any>;
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

            // Build queries for all game types
            const queries: Promise<any[]>[] = [];

            // Wingo bets
            const wingoWhere: any = {};
            if (userId) wingoWhere.userId = userId;

            queries.push(
                prisma.wingoBet.findMany({
                    where: wingoWhere,
                    include: {
                        user: {
                            select: ADMIN_USER_IDENTITY_SELECT,
                        },
                        period: {
                            select: {
                                periodNumber: true,
                                durationSeconds: true,
                            },
                        },
                        wingoBetResult: true,
                    },
                    orderBy: {
                        createdAt: "desc",
                    },
                })
            );

            // FiveD bets
            const fiveDWhere: any = {};
            if (userId) fiveDWhere.userId = userId;

            queries.push(
                prisma.fiveDBet.findMany({
                    where: fiveDWhere,
                    include: {
                        user: {
                            select: ADMIN_USER_IDENTITY_SELECT,
                        },
                        period: {
                            select: {
                                periodNumber: true,
                            },
                        },
                        fiveDBetResult: true,
                    },
                    orderBy: {
                        createdAt: "desc",
                    },
                })
            );

            // K3 bets
            const k3Where: any = {};
            if (userId) k3Where.userId = userId;

            queries.push(
                prisma.k3Bet.findMany({
                    where: k3Where,
                    include: {
                        user: {
                            select: ADMIN_USER_IDENTITY_SELECT,
                        },
                        period: {
                            select: {
                                periodNumber: true,
                            },
                        },
                        k3BetResult: true,
                    },
                    orderBy: {
                        createdAt: "desc",
                    },
                })
            );

            // Moto bets
            const motoWhere: any = {};
            if (userId) motoWhere.userId = userId;

            queries.push(
                prisma.motoBet.findMany({
                    where: motoWhere,
                    include: {
                        user: {
                            select: ADMIN_USER_IDENTITY_SELECT,
                        },
                        period: {
                            select: {
                                periodNumber: true,
                            },
                        },
                        motoBetResult: true,
                    },
                    orderBy: {
                        createdAt: "desc",
                    },
                })
            );

            // TrxWingo bets
            const trxWingoWhere: any = {};
            if (userId) trxWingoWhere.userId = userId;

            queries.push(
                prisma.trxWingoBet.findMany({
                    where: trxWingoWhere,
                    include: {
                        user: {
                            select: ADMIN_USER_IDENTITY_SELECT,
                        },
                        period: {
                            select: {
                                periodNumber: true,
                            },
                        },
                        trxWingoBetResult: true,
                    },
                    orderBy: {
                        createdAt: "desc",
                    },
                })
            );

            // Inout bets
            const inoutWhere: any = {};
            if (userId) inoutWhere.userId = userId;
            if (gameName) {
                inoutWhere.gameMode = {
                    contains: gameName,
                    mode: "insensitive",
                };
            }

            queries.push(
                prisma.inoutBet.findMany({
                    where: inoutWhere,
                    include: {
                        user: {
                            select: ADMIN_USER_IDENTITY_SELECT,
                        },
                    },
                    orderBy: {
                        createdAt: "desc",
                    },
                })
            );

            // Execute all queries in parallel
            const results = await Promise.all(queries);

            // Normalize all bets into a common format
            let allBets: Array<{
                id: string;
                majorGameType:
                | "WINGO"
                | "FIVE_D"
                | "K3"
                | "MOTO"
                | "TRX_WINGO"
                | "INOUT";
                gameName: string;
                betAmount: number;
                winAmount: number;
                status: string;
                createdAt: Date;
                user: ReturnType<typeof mapAdminUserIdentity>;
                metadata?: Record<string, any>;
            }> = [];

            let queryIndex = 0;

            // Process Wingo bets
            const wingoBets = results[queryIndex++];
            allBets.push(
                ...wingoBets.map((bet: any) => ({
                    id: bet.id,
                    majorGameType: "WINGO" as const,
                    gameName: wingoGameName(bet.period.durationSeconds),
                    betAmount: bet.betAmount,
                    winAmount: bet.wingoBetResult?.winAmount || 0,
                    status: bet.status,
                    createdAt: bet.createdAt,
                    user: mapAdminUserIdentity(bet.user),
                    metadata: {
                        periodNumber: bet.period.periodNumber,
                        betType: bet.betType,
                        betChoice: bet.betChoice,
                    },
                }))
            );

            // Process FiveD bets
            const fiveDBets = results[queryIndex++];
            allBets.push(
                ...fiveDBets.map((bet: any) => ({
                    id: bet.id,
                    majorGameType: "FIVE_D" as const,
                    gameName: "5D Lotre",
                    betAmount: bet.betAmount,
                    winAmount: bet.fiveDBetResult?.winAmount || 0,
                    status: bet.status,
                    createdAt: bet.createdAt,
                    user: mapAdminUserIdentity(bet.user),
                    metadata: {
                        periodNumber: bet.period.periodNumber,
                        betType: bet.betType,
                    },
                }))
            );

            // Process K3 bets
            const k3Bets = results[queryIndex++];
            allBets.push(
                ...k3Bets.map((bet: any) => ({
                    id: bet.id,
                    majorGameType: "K3" as const,
                    gameName: "K3 Lotre",
                    betAmount: bet.betAmount,
                    winAmount: bet.k3BetResult?.winAmount || 0,
                    status: bet.status,
                    createdAt: bet.createdAt,
                    user: mapAdminUserIdentity(bet.user),
                    metadata: {
                        periodNumber: bet.period.periodNumber,
                        betType: bet.betType,
                    },
                }))
            );

            // Process Moto bets
            const motoBets = results[queryIndex++];
            allBets.push(
                ...motoBets.map((bet: any) => ({
                    id: bet.id,
                    majorGameType: "MOTO" as const,
                    gameName: "Moto",
                    betAmount: bet.betAmount,
                    winAmount: bet.motoBetResult?.winAmount || 0,
                    status: bet.status,
                    createdAt: bet.createdAt,
                    user: mapAdminUserIdentity(bet.user),
                    metadata: {
                        periodNumber: bet.period.periodNumber,
                        betType: bet.betType,
                    },
                }))
            );

            // Process TrxWingo bets
            const trxWingoBets = results[queryIndex++];
            allBets.push(
                ...trxWingoBets.map((bet: any) => ({
                    id: bet.id,
                    majorGameType: "TRX_WINGO" as const,
                    gameName: "TRX Wingo",
                    betAmount: bet.betAmount,
                    winAmount: bet.trxWingoBetResult?.winAmount || 0,
                    status: bet.status,
                    createdAt: bet.createdAt,
                    user: mapAdminUserIdentity(bet.user),
                    metadata: {
                        periodNumber: bet.period.periodNumber,
                        betType: bet.betType,
                        betChoice: bet.betChoice,
                    },
                }))
            );

            // Process Inout bets
            const inoutBets = results[queryIndex++];
            allBets.push(
                ...inoutBets.map((bet: any) => ({
                    id: bet.id,
                    majorGameType: "INOUT" as const,
                    gameName: bet.gameMode,
                    betAmount: bet.betAmount,
                    winAmount: bet.winAmount,
                    status: bet.isSettled ? "PENDING" : "SETTLED",
                    createdAt: bet.createdAt,
                    user: mapAdminUserIdentity(bet.user),
                }))
            );

            // Apply filters
            if (gameName) {
                allBets = allBets.filter((bet) =>
                    bet.gameName.toLowerCase().includes(gameName.toLowerCase())
                );
            }

            if (wins === "true") {
                allBets = allBets.filter((bet) => bet.winAmount > 0);
            } else if (wins === "false") {
                allBets = allBets.filter((bet) => bet.winAmount === 0);
            }

            // Sort by createdAt desc
            allBets.sort(
                (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
            );

            // Apply pagination
            const total = allBets.length;
            const paginatedBets = allBets.slice(skip, skip + limit);
            const totalPages = Math.ceil(total / limit);

            const result = {
                bets: paginatedBets.map((bet) => ({
                    id: bet.id,
                    majorGameType: bet.majorGameType,
                    gameName: bet.gameName,
                    betAmount: bet.betAmount,
                    winAmount: bet.winAmount,
                    status: bet.status,
                    user: bet.user,
                    createdAt: bet.createdAt.toISOString(),
                    metadata: bet.metadata,
                })),
                total,
                currentPage: page,
                totalPages,
            };

            // Cache for 15 minutes
            await Cache.hset(mainCacheKey, fieldKey, result, 60 * 15);

            return c.json(
                {
                    success: true,
                    ...result,
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
