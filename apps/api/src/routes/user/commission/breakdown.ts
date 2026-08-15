import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import {
    commissionBreakdownQuerySchema,
    commissionRecordSchema,
} from "@/schemas/commission";
import { Cache, CacheKey } from "@bcwin/cache";
import {
    isValidYmd,
    parseYmdEndInclusiveIst,
    parseYmdStartIst,
} from "@/lib/istDate";

const logger = new Logger("commission-breakdown");

const commissionBreakdownResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    data: z.array(commissionRecordSchema).openapi({
        description: "Array of commission records",
    }),
    summary: z
        .object({
            totalCommission: z.number().openapi({
                description: "Total commission amount",
                example: 500.75,
            }),
            totalBetAmount: z.number().optional().openapi({
                description: "Sum of subordinate bet amounts in range",
                example: 100000,
            }),
            byLayer: z
                .object({
                    layer1: z.number().openapi({ example: 300 }),
                    layer2: z.number().openapi({ example: 100 }),
                    layer3: z.number().openapi({ example: 50 }),
                    layer4: z.number().openapi({ example: 25 }),
                    layer5: z.number().openapi({ example: 15 }),
                    layer6: z.number().openapi({ example: 10.75 }),
                })
                .openapi({
                    description: "Commission breakdown by layer",
                }),
            byGameType: z.record(z.string(), z.number()).openapi({
                description: "Commission breakdown by game type",
                example: { WINGO: 300, "5D": 100, K3: 50, MOTO: 50.75 },
            }),
        })
        .openapi({
            description: "Commission summary statistics",
        }),
});

const getCommissionBreakdownRoute = createRoute({
    method: "get",
    tags: ["user"],
    path: "/breakdown",
    summary: "Get commission breakdown",
    description:
        "Retrieve detailed commission records with breakdown by layer and game type",
    request: {
        cookies: authCookie,
        query: commissionBreakdownQuerySchema,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: commissionBreakdownResponseSchema,
                },
            },
            description: "Successfully retrieved commission breakdown",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

export const breakdownRoutes = (app: OpenAPIHono) => {
    app.openapi(getCommissionBreakdownRoute, async (c) => {
        try {
            const user = c.get("user");
            const { startDate, endDate, layer } = c.req.valid("query");

            if (startDate && !isValidYmd(startDate)) {
                return apiError(
                    c,
                    "Invalid startDate. Use YYYY-MM-DD",
                    HTTP_STATUS.BAD_REQUEST
                );
            }
            if (endDate && !isValidYmd(endDate)) {
                return apiError(
                    c,
                    "Invalid endDate. Use YYYY-MM-DD",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            // Check cache using hash-based caching
            const mainCacheKey = CacheKey.commissionBreakdown(user.id);
            const fieldKey = `v2-start:${startDate || "none"}-end:${endDate || "none"
                }-layer:${layer || "all"}`;

            const cachedData = await Cache.hget<{
                data: Array<{
                    id: string;
                    fromUser: { id: string; username: string };
                    layer: number;
                    userVipLevel: number;
                    commissionRate: number;
                    betAmount: number;
                    commissionAmount: number;
                    betType: string;
                    createdAt: string;
                }>;
                summary: {
                    totalCommission: number;
                    totalBetAmount: number;
                    byLayer: {
                        layer1: number;
                        layer2: number;
                        layer3: number;
                        layer4: number;
                        layer5: number;
                        layer6: number;
                    };
                    byGameType: Record<string, number>;
                };
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

            const whereClause: {
                userId: string;
                layer?: number;
                OR?: Array<Record<string, unknown>>;
                createdAt?: { gte?: Date; lte?: Date };
            } = {
                userId: user.id,
            };

            // IST date range — match both calculationDate and createdAt so live
            // commissions always appear for the day the user selected
            if (startDate || endDate) {
                const gte = startDate
                    ? parseYmdStartIst(startDate)
                    : undefined;
                const lte = endDate
                    ? parseYmdEndInclusiveIst(endDate)
                    : undefined;
                const dateFilter: { gte?: Date; lte?: Date } = {};
                if (gte) dateFilter.gte = gte;
                if (lte) dateFilter.lte = lte;
                whereClause.OR = [
                    { calculationDate: dateFilter },
                    { createdAt: dateFilter },
                ];
            }

            // Layer filter
            if (layer) {
                const layerNum = parseInt(layer);
                if (layerNum >= 1 && layerNum <= 6) {
                    whereClause.layer = layerNum;
                } else {
                    return apiError(
                        c,
                        "Layer must be between 1 and 6",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }
            }

            // Full aggregates (not capped) so summary is correct for the range
            const [commissions, totalAgg, layerGroups, gameGroups] =
                await Promise.all([
                    prisma.commission.findMany({
                        where: whereClause,
                        include: {
                            fromUser: {
                                select: {
                                    id: true,
                                    username: true,
                                },
                            },
                        },
                        orderBy: { createdAt: "desc" },
                        // Soft cap for list UI; summary uses full aggregate below
                        take: 1000,
                    }),
                    prisma.commission.aggregate({
                        where: whereClause,
                        _sum: {
                            commissionAmount: true,
                            betAmount: true,
                        },
                    }),
                    prisma.commission.groupBy({
                        by: ["layer"],
                        where: whereClause,
                        _sum: { commissionAmount: true },
                    }),
                    prisma.commission.groupBy({
                        by: ["betType"],
                        where: whereClause,
                        _sum: { commissionAmount: true },
                    }),
                ]);

            const byLayer: {
                layer1: number;
                layer2: number;
                layer3: number;
                layer4: number;
                layer5: number;
                layer6: number;
            } = {
                layer1: 0,
                layer2: 0,
                layer3: 0,
                layer4: 0,
                layer5: 0,
                layer6: 0,

            };
            for (const g of layerGroups) {
                const key = `layer${g.layer}` as keyof typeof byLayer;
                if (key in byLayer) {
                    byLayer[key] = g._sum.commissionAmount || 0;
                }
            }
            const byGameType: Record<string, number> = {};
            for (const g of gameGroups) {
                byGameType[g.betType] = g._sum.commissionAmount || 0;
            }

            const result = {
                data: commissions.map((commission) => ({
                    id: commission.id,
                    fromUser: {
                        id: commission.fromUser.id,
                        username: commission.fromUser.username,
                    },
                    layer: commission.layer,
                    userVipLevel: commission.userVipLevel,
                    commissionRate: commission.commissionRate,
                    betAmount: commission.betAmount,
                    commissionAmount: commission.commissionAmount,
                    betType: commission.betType,
                    createdAt: commission.createdAt.toISOString(),
                })),
                summary: {
                    totalCommission: totalAgg._sum.commissionAmount || 0,
                    totalBetAmount: totalAgg._sum.betAmount || 0,
                    byLayer,
                    byGameType,
                },
            };

            // Cache for 2 minutes (shorter so live commissions show sooner)
            await Cache.hset(mainCacheKey, fieldKey, result, 60 * 2);

            return c.json(
                {
                    success: true,
                    ...result,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error fetching commission breakdown:", error);
            return apiError(
                c,
                "Failed to fetch commission breakdown",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
