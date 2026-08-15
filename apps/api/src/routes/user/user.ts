import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie, mobileNumber } from "@/schemas";
import { prisma, Role } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import { syncVipLevelFromXp } from "@/lib/vipLevelSync";

const logger = new Logger("user");

const userResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the user details were fetched successfully",
        example: true,
    }),
    user: z.object({
        id: z.string().openapi({
            description: "User id",
            format: "uuid",
            example: "147f8c93-b8c2-4435-8534-9ac4ad282ca5",
        }),
        username: z.string().openapi({
            description: "Username",
            example: "john_doe",
        }),
        serialNumber: z.number().openapi({
            description: "User serial number",
            example: 123456,
        }),
        mobileNumber,
        email: z
            .string()
            .email()
            .nullable()
            .optional()
            .openapi({
                description: "Registered email (email login / OTP)",
                example: "user@example.com",
            }),
        balance: z.number().openapi({
            description: "Balance",
            example: 100,
        }),
        role: z.enum(Role).openapi({
            description: "Role",
            example: "USER",
        }),
        referralCode: z.string().openapi({
            description: "Referral code",
            example: "1234567890",
        }),
        isBanned: z.boolean().openapi({
            description: "Whether the user is banned",
            example: false,
        }),
        isDemo: z.boolean().openapi({
            description: "Whether the user is a demo user",
            example: false,
        }),
        referredBy: z.string().optional().openapi({
            description: "Referral code of the user who referred you",
            example: "1234567890",
        }),
        vipLevel: z.number().openapi({
            description: "Current VIP level of the user",
            example: 0,
        }),
        lastLoginDate: z
            .string()
            .datetime()
            .nullable()
            .optional()
            .openapi({
                description:
                    "Last successful login timestamp (ISO). Used on profile under UID.",
                example: "2026-08-11T09:00:00.000Z",
            }),
    }),
});

const UpdateUsernameBodySchema = z.object({
    username: z
        .string()
        .min(3)
        .max(20)
        .regex(
            /^[a-zA-Z0-9_]+$/,
            "Username can only contain letters, numbers, and underscores"
        )
        .openapi({
            description: "New username (3-20 characters, letters, numbers, underscores)",
            example: "john_doe_new",
        }),
});

const UpdateUsernameResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the action was successful",
        example: true,
    }),
    message: z.string().openapi({
        description: "Status message",
        example: "Username updated successfully",
    }),
    username: z.string().openapi({
        description: "Updated username",
        example: "john_doe_new",
    }),
});

const userRoute = createRoute({
    method: "get",
    path: "/user",
    tags: ["user"],
    summary: "Get user details",
    description: "Get the details of the user",
    request: {
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: userResponseSchema,
                },
            },
            description: "Get user details",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

const updateUsernameRoute = createRoute({
    method: "put",
    path: "/update-username",
    tags: ["user"],
    summary: "Update username",
    description: "Update the user's username",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: UpdateUsernameBodySchema,
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: UpdateUsernameResponseSchema,
                },
            },
            description: "Username updated successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

const BindEmailBodySchema = z.object({
    email: z.string().email().openapi({
        description: "Email to bind (must receive OTP first)",
        example: "user@example.com",
    }),
    otp: z
        .string()
        .regex(/^\d{6}$/, "OTP must be a 6-digit number")
        .openapi({
            description: "6-digit OTP sent to the email",
            example: "123456",
        }),
});

const BindEmailResponseSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    email: z.string().email(),
});

const bindEmailRoute = createRoute({
    method: "put",
    path: "/bind-email",
    tags: ["user"],
    summary: "Bind email to account",
    description:
        "Bind an email address to the current user (only if none is set). Requires email OTP.",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: BindEmailBodySchema,
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: BindEmailResponseSchema,
                },
            },
            description: "Email bound successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

async function verifyEmailOtp(email: string, otp: string): Promise<boolean> {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const otpData = await prisma.otp.findFirst({
        where: {
            email: email.toLowerCase(),
            otp,
            updatedAt: { gte: fiveMinutesAgo },
        },
    });
    return Boolean(otpData);
}

export const userRoutes = (app: OpenAPIHono) => {
    app.openapi(userRoute, async (c) => {
        try {
            const user = c.get("user");

            // Keep profile badge in sync with XP (not only daily VIP cron)
            const currentLevel = await syncVipLevelFromXp(user.id);

            return c.json(
                {
                    success: true,
                    user: {
                        id: user.id,
                        username: user.username,
                        serialNumber: user.serialNumber,
                        mobileNumber: user.mobileNumber,
                        email: user.email ?? null,
                        balance: user.balance,
                        role: user.role,
                        referralCode: user.referralCode,
                        isBanned: user.isBanned,
                        isDemo: user.isDemo,
                        referredBy: user.referredBy ?? undefined,
                        vipLevel: currentLevel,
                        lastLoginDate: user.lastLoginDate
                            ? user.lastLoginDate.toISOString()
                            : null,
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

    app.openapi(updateUsernameRoute, async (c) => {
        try {
            const user = c.get("user");
            const { username: newUsername } = c.req.valid("json");

            if (user.username === newUsername) {
                return apiError(
                    c,
                    "New username cannot be the same as current username",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            // Check if username is already taken by another user
            const existingUser = await prisma.user.findFirst({
                where: {
                    username: newUsername,
                    NOT: {
                        id: user.id,
                    },
                },
            });

            if (existingUser) {
                return apiError(
                    c,
                    "Username is already taken",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            await prisma.user.update({
                where: {
                    id: user.id,
                },
                data: {
                    username: newUsername,
                },
            });

            // Invalidate relevant cache
            await Cache.del(CacheKey.adminUsers);
            await Cache.del(CacheKey.adminUserStats(user.id));

            return c.json(
                {
                    success: true,
                    message: "Username updated successfully",
                    username: newUsername,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error updating username:", error);
            return apiError(
                c,
                "Failed to update username",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.openapi(bindEmailRoute, async (c) => {
        try {
            const user = c.get("user");
            const { email: rawEmail, otp } = c.req.valid("json");
            const email = rawEmail.trim().toLowerCase();

            if (user.email) {
                return apiError(
                    c,
                    "Email already bound to this account",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            if (!(await verifyEmailOtp(email, otp))) {
                return apiError(
                    c,
                    "Invalid or expired OTP",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            const taken = await prisma.user.findFirst({
                where: {
                    email,
                    NOT: { id: user.id },
                },
                select: { id: true },
            });
            if (taken) {
                return apiError(
                    c,
                    "Email is already in use",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            await prisma.user.update({
                where: { id: user.id },
                data: { email },
            });

            // Consume OTP so it cannot be reused
            await prisma.otp
                .deleteMany({ where: { email } })
                .catch(() => undefined);

            await Cache.del(CacheKey.adminUsers);
            await Cache.del(CacheKey.adminUserStats(user.id));

            return c.json(
                {
                    success: true,
                    message: "Email bound successfully",
                    email,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error binding email:", error);
            return apiError(
                c,
                "Failed to bind email",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
