import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie, GetUserStatsResponseSchema } from "@/schemas";
import { prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import { calculateUserStats } from "./helpers";

const logger = new Logger("admin-users-stats");

const getUserStatsRoute = createRoute({
    method: "get",
    path: "/:id",
    tags: ["admin"],
    summary: "Get user details with stats",
    description:
        "Get detailed user information including recharge, withdraw, and bet statistics for user and their downlinks",
    request: {
        params: z.object({
            id: z.string().openapi({
                description: "User ID",
                example: "uuid-123",
            }),
        }),
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: GetUserStatsResponseSchema,
                },
            },
            description: "User details with statistics",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

export const statsRoutes = (app: OpenAPIHono) => {
    app.openapi(getUserStatsRoute, async (c) => {
        try {
            const { id } = c.req.valid("param");

            const cacheKey = CacheKey.adminUserStats(id);
            const cachedData = await Cache.get<{
                user: any;
            }>(cacheKey);

            if (cachedData) {
                return c.json(
                    {
                        success: true,
                        ...cachedData,
                    },
                    HTTP_STATUS.OK
                );
            }

            const user = await prisma.user.findUnique({
                where: { id },
                include: {
                    bank: {
                        select: {
                            fullName: true,
                            bankAccount: true,
                            ifsc: true,
                            trc20Address: true,
                            bep20Address: true,
                            upiId: true,
                        },
                    },
                    vipLevel: {
                        select: {
                            currentLevel: true,
                        },
                    },
                },
            });

            if (!user) {
                return apiError(c, "User not found", HTTP_STATUS.BAD_REQUEST);
            }

            // Get total commission from DailyCommissionSummary
            const commissionData =
                await prisma.dailyCommissionSummary.aggregate({
                    where: {
                        userId: id,
                    },
                    _sum: {
                        totalCommission: true,
                    },
                });

            const totalCommission = commissionData._sum.totalCommission || 0;
            const vipLevel = user.vipLevel?.currentLevel || 0;

            const stats = await calculateUserStats(id);

            const result = {
                user: {
                    id: user.id,
                    serialNumber: user.serialNumber,
                    username: user.username,
                    mobileNumber: user.mobileNumber,
                    balance: user.balance,
                    isBanned: user.isBanned,
                    hasIllegalBetPenalty: user.hasIllegalBetPenalty,
                    illegalBetPenaltyFactor: user.illegalBetPenaltyFactor,
                    isDemo: user.isDemo,
                    role: user.role,
                    referralCode: user.referralCode,
                    referredBy: user.referredBy,
                    createdAt: user.createdAt.toISOString(),
                    bank: user.bank,
                    stats: {
                        vipLevel,
                        totalCommission,
                        ...stats,
                    },
                },
            };

            await Cache.set(cacheKey, result, 60 * 5);

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
