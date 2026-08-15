import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import { prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";

const logger = new Logger("admin-agent-details");

// Agent details response schema
const agentDetailsResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    data: z.object({
        userID: z.string().openapi({
            description: "Agent user ID",
            example: "uuid-123",
        }),
        username: z.string().openapi({
            description: "Agent username",
            example: "agent123",
        }),
        mobile: z.string().openapi({
            description: "Agent mobile number",
            example: "9876543210",
        }),
        serialNumber: z.number().openapi({
            description: "Agent serial number",
            example: 123456,
        }),
        walletBalance: z.number().openapi({
            description: "Agent wallet balance",
            example: 5000.0,
        }),
        accountType: z.string().openapi({
            description: "Account type (role)",
            example: "AGENT",
        }),
        createdAt: z.string().openapi({
            description: "Account creation timestamp",
            example: "2025-01-12T10:30:00Z",
        }),
    }),
});

const getAgentDetailsRoute = createRoute({
    method: "get",
    path: "/:identifier",
    tags: ["admin"],
    summary: "Get agent details",
    description:
        "Get detailed information for a specific agent including userID, username, mobile, wallet balance, account type, and created at. Can be queried by agent ID or serialNumber.",
    request: {
        params: z.object({
            identifier: z.string().openapi({
                description: "Agent ID (UUID) or serialNumber (number)",
                example: "uuid-123",
            }),
        }),
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: agentDetailsResponseSchema,
                },
            },
            description: "Agent details retrieved successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

type AgentDetailsData = z.infer<typeof agentDetailsResponseSchema>["data"];

export const detailsRoutes = (app: OpenAPIHono) => {
    app.openapi(getAgentDetailsRoute, async (c) => {
        try {
            const { identifier } = c.req.valid("param");

            // Determine if identifier is a serialNumber (numeric) or id (UUID)
            const isSerialNumber = /^\d+$/.test(identifier);
            const whereCondition = isSerialNumber
                ? {
                      serialNumber: parseInt(identifier, 10),
                      role: "AGENT" as const,
                  }
                : { id: identifier, role: "AGENT" as const };

            // Verify agent exists and is an agent
            const agent = await prisma.user.findFirst({
                where: whereCondition,
                select: {
                    id: true,
                    username: true,
                    mobileNumber: true,
                    serialNumber: true,
                    balance: true,
                    role: true,
                    createdAt: true,
                },
            });

            if (!agent) {
                return apiError(c, "Agent not found", HTTP_STATUS.BAD_REQUEST);
            }

            if (agent.role !== "AGENT") {
                return apiError(
                    c,
                    "User is not an agent",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            // Use the actual agent ID for cache
            const agentId = agent.id;

            // Check cache
            const cacheKey = CacheKey.adminAgentPerformance(agentId);
            const fieldKey = "details";

            const cachedData = await Cache.hget<AgentDetailsData>(
                cacheKey,
                fieldKey
            );

            if (cachedData) {
                return c.json(
                    {
                        success: true,
                        data: cachedData,
                    },
                    HTTP_STATUS.OK
                );
            }

            const result: AgentDetailsData = {
                userID: agent.id,
                username: agent.username,
                mobile: agent.mobileNumber,
                serialNumber: agent.serialNumber,
                walletBalance: agent.balance,
                accountType: agent.role,
                createdAt: agent.createdAt.toISOString(),
            };

            // Cache for 5 minutes
            await Cache.hset(cacheKey, fieldKey, result, 60 * 5);

            return c.json(
                {
                    success: true,
                    data: result,
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
