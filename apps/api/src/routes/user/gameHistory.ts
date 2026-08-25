import { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import {
    gameHistoryQuerySchema,
    gameHistoryResponseSchema,
} from "@/schemas/gameHistory";
import { Cache, CacheKey } from "@bcwin/cache";
import { wingoGameName } from "@/lib/lotteryDuration";

const logger = new Logger("game-history");

const getGameHistoryRoute = createRoute({
    method: "get",
    tags: ["user"],
    path: "/game-history",
    summary: "Get game history",
    description:
        "Retrieve bet history across all games with pagination and filters (majorGameType, minorGameType, provider)",
    request: {
        cookies: authCookie,
        query: gameHistoryQuerySchema,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: gameHistoryResponseSchema,
                },
            },
            description: "Successfully retrieved game history",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

export const gameHistoryRoutes = (app: OpenAPIHono) => {
    app.openapi(getGameHistoryRoute, async (c) => {
        try {
            const user = c.get("user");
            const {
                page,
                limit,
                majorGameType
            } = c.req.valid("query");

            const skip = (page - 1) * limit;

            // Check cache
            const mainCacheKey = CacheKey.gameHistory(user.id);
            const fieldKey = `v3-major:${majorGameType || "all"}-page:${page}-limit:${limit}`;

            const cachedData = await Cache.hget<{
                data: Array<{
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

            // Determine which game types to query based on filters
            const shouldQueryWingo =
                !majorGameType ||
                majorGameType === "WINGO"

            const shouldQueryFiveD =
                !majorGameType ||
                majorGameType === "FIVE_D"

            const shouldQueryK3 =
                !majorGameType ||
                majorGameType === "K3"

            const shouldQueryMoto =
                !majorGameType ||
                majorGameType === "MOTO"

            const shouldQueryTrxWingo =
                !majorGameType ||
                majorGameType === "TRX_WINGO"

            const shouldQueryInout =
                !majorGameType || majorGameType === "INOUT";

            // Window per table: newest skip+limit. Merge then slice — same
            // order as loading every bet, without shipping the full history.
            const windowSize = skip + limit;
            const orderBy = { createdAt: "desc" as const };
            const uid = { userId: user.id };

            const queries: Promise<any[]>[] = [];
            const counts: Promise<number>[] = [];

            if (shouldQueryWingo) {
                queries.push(
                    prisma.wingoBet.findMany({
                        where: uid,
                        orderBy,
                        take: windowSize,
                        include: {
                            period: {
                                select: {
                                    periodNumber: true,
                                    durationSeconds: true,
                                },
                            },
                            wingoBetResult: true,
                        },
                    })
                );
                counts.push(prisma.wingoBet.count({ where: uid }));
            }

            if (shouldQueryFiveD) {
                queries.push(
                    prisma.fiveDBet.findMany({
                        where: uid,
                        orderBy,
                        take: windowSize,
                        include: {
                            period: {
                                select: {
                                    periodNumber: true,
                                },
                            },
                            fiveDBetResult: true,
                        },
                    })
                );
                counts.push(prisma.fiveDBet.count({ where: uid }));
            }

            if (shouldQueryK3) {
                queries.push(
                    prisma.k3Bet.findMany({
                        where: uid,
                        orderBy,
                        take: windowSize,
                        include: {
                            period: {
                                select: {
                                    periodNumber: true,
                                },
                            },
                            k3BetResult: true,
                        },
                    })
                );
                counts.push(prisma.k3Bet.count({ where: uid }));
            }

            if (shouldQueryMoto) {
                queries.push(
                    prisma.motoBet.findMany({
                        where: uid,
                        orderBy,
                        take: windowSize,
                        include: {
                            period: {
                                select: {
                                    periodNumber: true,
                                },
                            },
                            motoBetResult: true,
                        },
                    })
                );
                counts.push(prisma.motoBet.count({ where: uid }));
            }

            if (shouldQueryTrxWingo) {
                queries.push(
                    prisma.trxWingoBet.findMany({
                        where: uid,
                        orderBy,
                        take: windowSize,
                        include: {
                            period: {
                                select: {
                                    periodNumber: true,
                                },
                            },
                            trxWingoBetResult: true,
                        },
                    })
                );
                counts.push(prisma.trxWingoBet.count({ where: uid }));
            }

            if (shouldQueryInout) {
                queries.push(
                    prisma.inoutBet.findMany({
                        where: uid,
                        orderBy,
                        take: windowSize,
                    })
                );
                counts.push(prisma.inoutBet.count({ where: uid }));
            }

            const [results, countRows] = await Promise.all([
                Promise.all(queries),
                Promise.all(counts),
            ]);
            const total = countRows.reduce((s, n) => s + n, 0);

            // Normalize all bets into a common format
            let allBets: Array<{
                id: string;
                majorGameType: string;
                gameName: string;
                betAmount: number;
                winAmount: number;
                status: string;
                createdAt: Date;
                metadata?: Record<string, any>;
            }> = [];

            let queryIndex = 0;

            if (shouldQueryWingo) {
                const wingoBets = results[queryIndex++];
                allBets.push(
                    ...wingoBets.map((bet: any) => ({
                        id: bet.id,
                        majorGameType: "WINGO",
                        gameName: wingoGameName(bet.period.durationSeconds),
                        betAmount: bet.betAmount,
                        winAmount: bet.wingoBetResult?.winAmount || 0,
                        status: bet.status,
                        createdAt: bet.createdAt,
                        metadata: {
                            periodNumber: bet.period.periodNumber,
                            betType: bet.betType,
                            betChoice: bet.betChoice,
                            contractAmount: bet.contractAmount,
                        },
                    }))
                );
            }

            if (shouldQueryFiveD) {
                const fiveDBets = results[queryIndex++];
                allBets.push(
                    ...fiveDBets.map((bet: any) => ({
                        id: bet.id,
                        majorGameType: "FIVE_D",
                        gameName: "5D Lotre",
                        betAmount: bet.betAmount,
                        winAmount: bet.fiveDBetResult?.winAmount || 0,
                        status: bet.status,
                        createdAt: bet.createdAt,
                        metadata: {
                            periodNumber: bet.period.periodNumber,
                            betType: bet.betType,
                            betChoice: bet.betChoice,
                            position: bet.position,
                            betNumbers: bet.betNumbers,
                            contractAmount: bet.contractAmount,
                        },
                    }))
                );
            }

            if (shouldQueryK3) {
                const k3Bets = results[queryIndex++];
                allBets.push(
                    ...k3Bets.map((bet: any) => ({
                        id: bet.id,
                        majorGameType: "K3",
                        gameName: "K3 Lotre",
                        betAmount: bet.betAmount,
                        winAmount: bet.k3BetResult?.winAmount || 0,
                        status: bet.status,
                        createdAt: bet.createdAt,
                        metadata: {
                            periodNumber: bet.period.periodNumber,
                            betType: bet.betType,
                            betChoice: bet.betChoice,
                            contractAmount: bet.contractAmount,
                        },
                    }))
                );
            }

            if (shouldQueryMoto) {
                const motoBets = results[queryIndex++];
                allBets.push(
                    ...motoBets.map((bet: any) => ({
                        id: bet.id,
                        majorGameType: "MOTO",
                        gameName: "Moto",
                        betAmount: bet.betAmount,
                        winAmount: bet.motoBetResult?.winAmount || 0,
                        status: bet.status,
                        createdAt: bet.createdAt,
                        metadata: {
                            periodNumber: bet.period.periodNumber,
                            betType: bet.betType,
                            betChoice: bet.betChoice,
                            targetPosition: bet.targetPosition,
                            contractAmount: bet.contractAmount,
                        },
                    }))
                );
            }

            if (shouldQueryTrxWingo) {
                const trxWingoBets = results[queryIndex++];
                allBets.push(
                    ...trxWingoBets.map((bet: any) => ({
                        id: bet.id,
                        majorGameType: "TRX_WINGO",
                        gameName: "TRX Wingo",
                        betAmount: bet.betAmount,
                        winAmount: bet.trxWingoBetResult?.winAmount || 0,
                        status: bet.status,
                        createdAt: bet.createdAt,
                        metadata: {
                            periodNumber: bet.period.periodNumber,
                            betType: bet.betType,
                            betChoice: bet.betChoice,
                            contractAmount: bet.contractAmount,
                        },
                    }))
                );
            }

            if (shouldQueryInout) {
                const inoutBets = results[queryIndex++];
                allBets.push(
                    ...inoutBets.map((bet: any) => ({
                        id: bet.id,
                        majorGameType: "INOUT",
                        gameName: bet.gameMode,
                        betAmount: bet.betAmount,
                        winAmount: bet.winAmount,
                        status: bet.isSettled ? "SETTLED" : "PENDING",
                        createdAt: bet.createdAt,
                    }))
                );
            }

            allBets.sort(
                (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
            );

            const paginatedBets = allBets.slice(skip, skip + limit);
            const totalPages = Math.ceil(total / limit);

            const result = {
                data: paginatedBets.map((bet) => ({
                    id: bet.id,
                    majorGameType: bet.majorGameType as
                        | "WINGO"
                        | "FIVE_D"
                        | "K3"
                        | "MOTO"
                        | "TRX_WINGO"
                        | "INOUT",
                    gameName: bet.gameName,
                    betAmount: bet.betAmount,
                    winAmount: bet.winAmount,
                    status: bet.status,
                    createdAt: bet.createdAt.toISOString(),
                    metadata: bet.metadata,
                })),
                total,
                currentPage: page,
                totalPages,
            };

            // Short read cache — invalidated on every bet place/settle via
            // Cache.invalidateUserGameCaches (fresh history after play).
            // 2 min is enough for re-open without hammering multi-game queries.
            await Cache.hset(mainCacheKey, fieldKey, result, 60 * 2);

            return c.json(
                {
                    success: true,
                    ...result,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error fetching game history:", error);
            return apiError(
                c,
                "Failed to fetch game history",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
