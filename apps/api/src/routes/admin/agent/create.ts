import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";
import { createHash } from "crypto";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses, generateNextSerialNumber } from "@/lib/utils";
import { authCookie, AgentItemSchema } from "@/schemas";
import { prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";

const logger = new Logger("admin-agent-create");

// Create agent schema
const CreateAgentBodySchema = z.object({
    username: z.string().min(3).openapi({
        description: "Username for the agent",
        example: "agent123",
    }),
    password: z.string().min(8).openapi({
        description: "Password for the agent",
        example: "Password123!",
    }),
    mobileNumber: z
        .string()
        .regex(/^\d{10}$/, "Mobile number must be 10 digits")
        .openapi({
            description: "Mobile number for the agent",
            example: "9876543210",
        }),
});

const CreateAgentResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the action was successful",
        example: true,
    }),
    message: z.string().openapi({
        description: "Result message",
        example: "Agent created successfully",
    }),
    agent: AgentItemSchema,
});

const createAgentRoute = createRoute({
    method: "post",
    path: "/create",
    tags: ["admin"],
    summary: "Create agent",
    description: "Create a new agent user with AGENT role",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: CreateAgentBodySchema,
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: CreateAgentResponseSchema,
                },
            },
            description: "Agent created successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

const createReferralCode = (serialNumber: number) => {
    const randomLength = 6;
    const randomNumbers = Array.from({ length: randomLength }, () =>
        Math.floor(Math.random() * 10)
    ).join("");

    return `${serialNumber}-${randomNumbers}`;
};

export const createRoutes = (app: OpenAPIHono) => {
    app.openapi(createAgentRoute, async (c) => {
        try {
            const { username, password, mobileNumber } = c.req.valid("json");

            // Check if username already exists
            const existingUser = await prisma.user.findFirst({
                where: {
                    OR: [{ username }, { mobileNumber }],
                },
            });

            if (existingUser) {
                if (existingUser.username === username) {
                    return apiError(
                        c,
                        "Username already exists",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }
                if (existingUser.mobileNumber === mobileNumber) {
                    return apiError(
                        c,
                        "Mobile number already exists",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }
            }

            const serialNumber = await generateNextSerialNumber();
            const referralCode = createReferralCode(serialNumber);

            // Create agent user
            const agent = await prisma.user.create({
                data: {
                    serialNumber,
                    username,
                    mobileNumber,
                    password: createHash("md5").update(password).digest("hex"),
                    referralCode,
                    role: "AGENT",
                    balance: 0,
                },
            });



            // Invalidate cache
            await Cache.del(CacheKey.adminAgents);

            return c.json(
                {
                    success: true,
                    message: "Agent created successfully",
                    agent: {
                        id: agent.id,
                        serialNumber: agent.serialNumber,
                        username: agent.username,
                        mobileNumber: agent.mobileNumber,
                        balance: agent.balance,
                        role: agent.role,
                        isBanned: agent.isBanned,
                        createdAt: agent.createdAt.toISOString(),
                    },
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
