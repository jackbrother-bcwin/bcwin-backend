import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie, limit, page, AgentItemSchema } from "@/schemas";
import { prisma, type Prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import { adminUserSearchOr, normalizeAdminUserSearch } from "@/lib/adminUserSearch";

const logger = new Logger("admin-agent-list");

// List agents schema
const GetAgentsQuerySchema = z.object({
    page,
    limit,
    search: z.string().optional().openapi({
        description: "Search by serial, username, mobile, email, or referral code",
        example: "9876543210",
    }),
});

const GetAgentsResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    agents: z.array(AgentItemSchema),
    total: z.number().openapi({
        description: "Total number of agents",
        example: 10,
    }),
    currentPage: z.number().openapi({
        description: "Current page number",
        example: 1,
    }),
    totalPages: z.number().openapi({
        description: "Total number of pages",
        example: 1,
    }),
});

const getAgentsRoute = createRoute({
    method: "get",
    path: "/list",
    tags: ["admin"],
    summary: "List agents",
    description: "Get a paginated list of agents",
    request: {
        query: GetAgentsQuerySchema,
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: GetAgentsResponseSchema,
                },
            },
            description: "List of agents",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

export const listRoutes = (app: OpenAPIHono) => {
    app.openapi(getAgentsRoute, async (c) => {
        try {
            const { page, limit, search } = c.req.valid("query");
            const normalizedSearch = normalizeAdminUserSearch(search);

            const skip = (page - 1) * limit;

            // Check cache using hash-based caching
            const mainCacheKey = CacheKey.adminAgents;
            const fieldKey = `v2-search:${normalizedSearch || "none"}-page:${page}-limit:${limit}`;

            const cachedData = await Cache.hget<{
                agents: Array<{
                    id: string;
                    serialNumber: number;
                    username: string;
                    mobileNumber: string;
                    role: string;
                    balance: number;
                    isBanned: boolean;
                    hasIllegalBetPenalty: boolean;
                    illegalBetPenaltyFactor: number | null;
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

            const where: Prisma.UserWhereInput = {
                role: "AGENT" as const,
            };
            if (normalizedSearch) {
                where.OR = adminUserSearchOr(normalizedSearch);
            }

            const [agents, total] = await Promise.all([
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
                        role: true,
                        isBanned: true,
                        hasIllegalBetPenalty: true,
                        illegalBetPenaltyFactor: true,
                        createdAt: true,
                    },
                }),
                prisma.user.count({ where }),
            ]);

            const totalPages = Math.ceil(total / limit);

            const result = {
                agents: agents.map((agent) => ({
                    id: agent.id,
                    serialNumber: agent.serialNumber,
                    username: agent.username,
                    mobileNumber: agent.mobileNumber,
                    balance: agent.balance,
                    role: agent.role,
                    isBanned: agent.isBanned,
                    hasIllegalBetPenalty: agent.hasIllegalBetPenalty,
                    illegalBetPenaltyFactor: agent.illegalBetPenaltyFactor,
                    createdAt: agent.createdAt.toISOString(),
                })),
                total,
                currentPage: page,
                totalPages,
            };

            // Cache for 5 minutes
            await Cache.hset(mainCacheKey, fieldKey, result, 60 * 5);

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
