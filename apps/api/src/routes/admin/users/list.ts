import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import {
    authCookie,
    GetUsersQuerySchema,
    GetUsersResponseSchema,
} from "@/schemas";
import { prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import { adminUserSearchOr, normalizeAdminUserSearch } from "@/lib/adminUserSearch";

const logger = new Logger("admin-users-list");

const getUsersRoute = createRoute({
    method: "get",
    path: "/list",
    tags: ["admin"],
    summary: "Get users list",
    description:
        "Get a paginated list of users with optional search and filter",
    request: {
        query: GetUsersQuerySchema,
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: GetUsersResponseSchema,
                },
            },
            description: "List of users",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

export const listRoutes = (app: OpenAPIHono) => {
    app.openapi(getUsersRoute, async (c) => {
        try {
            const {
                page,
                limit,
                search,
                isBanned,
                hasIllegalBetPenalty,
                role,
                isDemo,
            } = c.req.valid("query");
            const normalizedSearch = normalizeAdminUserSearch(search);
            const skip = (page - 1) * limit;

            // Check cache using hash-based caching
            const mainCacheKey = CacheKey.adminUsers;
            const fieldKey = `v3-search:${normalizedSearch || "none"}-banned:${
                isBanned || "all"
            }-penalty:${hasIllegalBetPenalty || "all"}-role:${
                role || "all"
            }-demo:${isDemo || "all"}-page:${page}-limit:${limit}`;

            const cachedData = await Cache.hget<{
                users: Array<{
                    id: string;
                    serialNumber: number;
                    username: string;
                    mobileNumber: string;
                    balance: number;
                    isBanned: boolean;
                    hasIllegalBetPenalty: boolean;
                    illegalBetPenaltyFactor: number | null;
                    isDemo: boolean;
                    role: string;
                    referralCode: string;
                    referredBy: string | null;
                    createdAt: string;
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

            const where: any = {};

            if (normalizedSearch) {
                where.OR = adminUserSearchOr(normalizedSearch);
            }

            if (isBanned !== undefined) {
                where.isBanned = isBanned === "true";
            }

            if (hasIllegalBetPenalty !== undefined) {
                where.hasIllegalBetPenalty = hasIllegalBetPenalty === "true";
            }

            if (role) {
                where.role = role;
            }

            if (isDemo !== undefined) {
                where.isDemo = isDemo === "true";
            }

            const [users, total] = await Promise.all([
                prisma.user.findMany({
                    where,
                    take: limit,
                    skip,
                    orderBy: {
                        createdAt: "desc",
                    },
                    select: {
                        id: true,
                        serialNumber: true,
                        username: true,
                        mobileNumber: true,
                        balance: true,
                        isBanned: true,
                        hasIllegalBetPenalty: true,
                        illegalBetPenaltyFactor: true,
                        isDemo: true,
                        role: true,
                        referralCode: true,
                        referredBy: true,
                        createdAt: true,
                    },
                }),
                prisma.user.count({ where }),
            ]);

            const totalPages = Math.ceil(total / limit);

            const result = {
                users: users.map((user) => ({
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
                })),
                total,
                currentPage: page,
                totalPages,
            };

            // Cache for 3 minutes
            await Cache.hset(mainCacheKey, fieldKey, result, 60 * 3);

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
