import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";
import { createHash } from "crypto";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses, generateNextSerialNumber } from "@/lib/utils";
import { authCookie, UserItemSchema } from "@/schemas";
import { prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";

const logger = new Logger("admin-users-create");

const CreateUserBodySchema = z.object({
    username: z.string().min(3).openapi({
        description: "Username for the user",
        example: "user123",
    }),
    password: z.string().min(8).openapi({
        description: "Password for the user",
        example: "Password123!",
    }),
    mobileNumber: z
        .string()
        .regex(/^\d{10}$/, "Mobile number must be 10 digits")
        .openapi({
            description: "Mobile number for the user",
            example: "9876543210",
        }),
    role: z
        .enum(["USER", "AGENT", "SUB_ADMIN", "ADMIN"])
        .optional()
        .default("USER")
        .openapi({
            description: "Role for the new account (defaults to USER)",
            example: "AGENT",
        }),
    isDemo: z.boolean().optional().default(false).openapi({
        description: "Is demo account",
        example: false,
    }),
    referredBy: z.string().optional().openapi({
        description: "Referral code used by user",
        example: "XYZ789",
    }),
    balance: z.number().optional().default(0).openapi({
        description: "Balance for the user",
        example: 0,
    }),
});

const CreateUserResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the action was successful",
        example: true,
    }),
    message: z.string().openapi({
        description: "Result message",
        example: "User created successfully",
    }),
    user: UserItemSchema,
});

const createUserRoute = createRoute({
    method: "post",
    path: "/create",
    tags: ["admin"],
    summary: "Create user",
    description: "Create a new user",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: CreateUserBodySchema,
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: CreateUserResponseSchema,
                },
            },
            description: "User created successfully",
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

export const createUserRoutes = (app: OpenAPIHono) => {
    app.openapi(createUserRoute, async (c) => {
        try {
            const {
                username,
                password,
                mobileNumber,
                role: requestedRole,
                isDemo,
                referredBy,
                balance,
            } = c.req.valid("json");

            const role = requestedRole ?? "USER";
            const actor = c.get("user");

            // Only full ADMIN may create ADMIN or SUB_ADMIN accounts
            if (
                (role === "ADMIN" || role === "SUB_ADMIN") &&
                actor?.role !== "ADMIN"
            ) {
                return apiError(
                    c,
                    "Only ADMIN can create ADMIN or SUB_ADMIN accounts",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

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

            // Create user with selected role
            const createdUser = await prisma.user.create({
                data: {
                    serialNumber,
                    username,
                    mobileNumber,
                    password: createHash("md5").update(password).digest("hex"),
                    referralCode,
                    role,
                    balance: balance ?? 0,
                    isDemo: isDemo ?? false,
                    referredBy: referredBy ?? null,
                },
                select: {
                    id: true,
                    serialNumber: true,
                    username: true,
                    mobileNumber: true,
                    balance: true,
                    role: true,
                    isBanned: true,
                    isDemo: true,
                    referralCode: true,
                    referredBy: true,
                    createdAt: true,
                },
            });

            const user = {
                ...createdUser,
                createdAt: createdUser.createdAt.toISOString(),
            };

            // Invalidate cache
            await Cache.del(CacheKey.adminUsers);

            return c.json(
                {
                    success: true,
                    message: "User created successfully",
                    user,
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
