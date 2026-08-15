import { createRoute, RouteConfig, OpenAPIHono, z } from "@hono/zod-openapi";
import { setCookie, deleteCookie } from "hono/cookie";
import { createHash } from "crypto";

import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { recordDailyLogin } from "@bcwin/activity-bonus";
import { apiError, CommonResponses, getClientIp, generateNextSerialNumber } from "@/lib/utils";
import { HTTP_STATUS } from "@/lib/http";
import {
    AUTH_COOKIE_NAME,
    authCookieOptions,
    generateToken,
} from "@/lib/auth";
import { countryCodeSchema, mobileNumber } from "@/schemas";
import { buildE164, getCountryRule } from "@/lib/countryPhone";
import { logIpActivity, IpActivityType } from "@/lib/ipActivity";

const logger = new Logger("auth");

const createAuthRoute = <T extends RouteConfig>(config: T) => {
    return createRoute({
        tags: ["auth"],
        ...config,
    });
};

const getPasswordSchema = (isForgotRoute = false) => {
    let description =
        "Password must be at least 8 characters long and must contain at least one lowercase letter, one uppercase letter, one number, and one special character";

    if (isForgotRoute) {
        description = "New Password must be at least 8 characters long";
    }

    return z
        .string()
        .min(8, { message: "Password must be at least 8 characters long" })
        .refine((value) => /[a-z]/.test(value), {
            message: "Password must contain at least one lowercase letter",
        })
        .refine((value) => /[A-Z]/.test(value), {
            message: "Password must contain at least one uppercase letter",
        })
        .refine((value) => /\d/.test(value), {
            message: "Password must contain at least one number",
        })
        .refine((value) => /[^a-zA-Z0-9]/.test(value), {
            message:
                "Password must contain at least one special character (e.g., !@#$%^&*)",
        })
        .openapi({
            description,
            example: "Password123!",
            title: isForgotRoute ? "New Password" : "Password",
        });
};

const otp = z.coerce
    .string()
    .regex(/^\d{6}$/, "OTP must be a 6-digit number")
    .openapi({
        description: "OTP must be a 6-digit number",
        example: "123456",
    });

const countryCodeField = countryCodeSchema.default("91").openapi({
    description:
        "ITU country dialing code (digits). Major markets allowed on register; SMS OTP still only 91|92|880.",
    example: "91",
});

function refinePhonePair(
    val: { countryCode: string; mobileNumber: string },
    ctx: z.RefinementCtx
) {
    const rule = getCountryRule(val.countryCode);
    if (!rule) {
        ctx.addIssue({
            code: "custom",
            path: ["countryCode"],
            message: "Unsupported country code",
        });
        return;
    }
    const n = val.mobileNumber;
    if (n.length < rule.minLen || n.length > rule.maxLen) {
        ctx.addIssue({
            code: "custom",
            path: ["mobileNumber"],
            message: `${rule.name} (+${rule.code}) mobile must be ${rule.minLen}${
                rule.minLen === rule.maxLen ? "" : `–${rule.maxLen}`
            } digits`,
        });
    }
}

const LoginSchema = z
    .object({
        countryCode: countryCodeField.optional(),
        mobileNumber: mobileNumber.optional(),
        email: z.string().email().optional().openapi({
            description: "Email address to login",
            example: "user@example.com",
        }),
        password: z.string().openapi({
            description: "Password",
            example: "Password123!",
        }),
    })
    .superRefine((val, ctx) => {
        if (!val.email && !val.mobileNumber) {
            ctx.addIssue({
                code: "custom",
                path: ["mobileNumber"],
                message: "Either mobileNumber or email must be provided",
            });
            return;
        }
        if (val.mobileNumber) {
            const code = val.countryCode || "91";
            const rule = getCountryRule(code);
            if (rule) {
                const n = val.mobileNumber;
                if (n.length < rule.minLen || n.length > rule.maxLen) {
                    ctx.addIssue({
                        code: "custom",
                        path: ["mobileNumber"],
                        message: `${rule.name} (+${rule.code}) mobile must be ${rule.minLen}${
                            rule.minLen === rule.maxLen ? "" : `–${rule.maxLen}`
                        } digits`,
                    });
                }
            } else {
                ctx.addIssue({
                    code: "custom",
                    path: ["countryCode"],
                    message: "Unsupported country code",
                });
            }
        }
    });

const registerSchema = z
    .object({
        username: z.string().min(3).max(20).openapi({
            description: "Username must be at least 3 characters long",
            example: "john_doe",
        }),
        password: getPasswordSchema(),
        countryCode: countryCodeField,
        mobileNumber,
        email: z.string().email().optional().openapi({
            description: "Optional email address",
            example: "user@example.com",
        }),
        otp,
        /** Required — any existing User.referralCode is accepted (no ban/demo filter) */
        referredBy: z
            .string()
            .trim()
            .min(1, { message: "Invite code is required" })
            .openapi({
                description:
                    "Required referral/invite code of an existing user (User.referralCode)",
                example: "10001-123456",
            }),
    })
    .superRefine(refinePhonePair);

const forgotSchema = z
    .object({
        password: getPasswordSchema(true),
        countryCode: countryCodeField,
        mobileNumber,
        otp,
    })
    .superRefine(refinePhonePair);

const LoginResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the login was successful",
        example: true,
    }),
    token: z.string().openapi({
        description:
            "JWT token for authentication. No need to actively use this as auth cookie is automatically set upon login",
        example: "1234567890",
    }),
});

const registerResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the registration was successful",
        example: true,
    }),
    token: z.string().openapi({
        description:
            "JWT token for authentication. No need to actively use this as auth cookie is automatically set upon registration",
        example: "1234567890",
    }),
});

const LogoutResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the logout was successful",
        example: true,
    }),
});

const forgotResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the forgot password was successful",
        example: true,
    }),
});

const LoginRoute = createAuthRoute({
    method: "post",
    path: "/login",
    description: "Login a user",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: LoginSchema,
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: LoginResponseSchema,
                },
            },
            description:
                "The login endpoint will set auth cookie automatically",
        },
        ...CommonResponses.unauthorized(),
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

const RegisterRoute = createAuthRoute({
    method: "post",
    path: "/register",
    description: "Register a new user",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: registerSchema,
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: registerResponseSchema,
                },
            },
            description:
                "The register endpoint will set auth cookie automatically",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

const LogoutRoute = createAuthRoute({
    method: "get",
    path: "/logout",
    description: "Logout the user",
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: LogoutResponseSchema,
                },
            },
            description: "Logout",
        },
        ...CommonResponses.internalServerError(),
    },
});

const ForgotRoute = createAuthRoute({
    method: "post",
    path: "/forgot",
    description: "Reset password",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: forgotSchema,
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: forgotResponseSchema,
                },
            },
            description: "Forgot password",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

const verifyOtp = async (identifier: string, otp: string) => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const otpData = await prisma.otp.findFirst({
        where: {
            OR: [
                { mobileNumber: identifier },
                { email: identifier.toLowerCase() },
            ],
            otp,
            updatedAt: {
                gte: fiveMinutesAgo,
            },
        },
    });

    if (otpData) {
        return true;
    }

    return false;
};

const createReferralCode = (serialNumber: number) => {
    const randomLength = 6;

    const randomNumbers = Array.from({ length: randomLength }, () =>
        Math.floor(Math.random() * 10)
    ).join("");

    return `${serialNumber}-${randomNumbers}`;
};

export const authRoutes = (app: OpenAPIHono) => {
    app.openapi(LoginRoute, async (c) => {
        try {
            const { countryCode = "91", mobileNumber: mob, email, password } = c.req.valid("json");

            let user = null;
            if (email) {
                const targetEmail = email.trim().toLowerCase();
                user = await prisma.user.findUnique({
                    where: { email: targetEmail },
                });
            } else if (mob) {
                const e164 = buildE164(countryCode || "91", mob);
                // Prefer E.164; legacy India accounts may be stored as bare 10 digits
                user = await prisma.user.findUnique({
                    where: { mobileNumber: e164 },
                });
                if (!user && countryCode === "91") {
                    user = await prisma.user.findUnique({
                        where: { mobileNumber: mob },
                    });
                }
            }

            if (!user) {
                return apiError(
                    c,
                    "Wrong account or password",
                    HTTP_STATUS.UNAUTHORIZED
                );
            }

            const ip = getClientIp(c);

            if (ip) {
                const ipData = await prisma.ip.findUnique({
                    where: {
                        ip,
                    },
                });

                if (ipData) {
                    if (ipData.isBlacklisted) {
                        return apiError(
                            c,
                            "This IP is blacklisted. Please contact support.",
                            HTTP_STATUS.UNAUTHORIZED
                        );
                    }
                } else {
                    await prisma.ip.create({
                        data: {
                            ip,
                        },
                    });
                }

                // Update user's IP
                await prisma.user.update({
                    where: {
                        id: user.id,
                    },
                    data: {
                        ip,
                    },
                });
            } else {
                logger.warn(
                    "[LOGIN] No ip found",
                    {
                        userId: user.id,
                        username: user.username,
                        mobileNumber: mob,
                        email,
                        reqHeaders: {
                            ...c.req.header(),
                        },
                    },
                    {
                        beautify: true,
                    }
                );
            }

            if (
                user.password !=
                createHash("md5").update(password).digest("hex")
            ) {
                return apiError(
                    c,
                    "Wrong account or password",
                    HTTP_STATUS.UNAUTHORIZED
                );
            }

            if (user.isBanned) {
                return apiError(
                    c,
                    "Your account is banned",
                    HTTP_STATUS.UNAUTHORIZED
                );
            }

            const token = await generateToken(user);

            setCookie(c, AUTH_COOKIE_NAME, token, authCookieOptions());

            // Daily login / attendance streak (IST) — must not block login response
            void recordDailyLogin(user.id).catch((err) =>
                logger.error("recordDailyLogin failed on login", err)
            );

            // Log IP activity for successful login
            if (ip) {
                logIpActivity({
                    ip,
                    userId: user.id,
                    activityType: IpActivityType.LOGIN,
                    metadata: { mobileNumber: mob, email },
                });
            }

            return c.json({ success: true, token }, HTTP_STATUS.OK);
        } catch (error) {
            logger.error(error);
            return apiError(
                c,
                "Internal server error",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.openapi(RegisterRoute, async (c) => {
        try {
            const {
                username,
                password,
                countryCode,
                mobileNumber: mob,
                email,
                otp,
                referredBy,
            } = c.req.valid("json");
            const e164 = buildE164(countryCode || "91", mob);
            const targetEmail = email ? email.trim().toLowerCase() : null;

            // OTP is stored under full international number or email
            const otpValid = (await verifyOtp(e164, otp)) || (targetEmail ? await verifyOtp(targetEmail, otp) : false);
            if (!otpValid) {
                return apiError(
                    c,
                    "Invalid or expired OTP",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            if (targetEmail) {
                const existingUserWithEmail = await prisma.user.findUnique({
                    where: {
                        email: targetEmail,
                    },
                });

                if (existingUserWithEmail) {
                    return apiError(
                        c,
                        "User with same email already exists",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }
            }

            const ip = getClientIp(c);

            if (ip) {
                const ipData = await prisma.ip.findUnique({
                    where: {
                        ip,
                    },
                });

                if (ipData) {
                    if (ipData.isBlacklisted) {
                        return apiError(
                            c,
                            "This IP is blacklisted. Please contact support.",
                            HTTP_STATUS.UNAUTHORIZED
                        );
                    }
                } else {
                    await prisma.ip.create({
                        data: {
                            ip,
                        },
                    });
                }
            } else {
                logger.warn(
                    "[REGISTER] No ip found",
                    {
                        username,
                        mobileNumber: mob,
                        email,
                        reqHeaders: {
                            ...c.req.header(),
                        },
                    },
                    {
                        beautify: true,
                    }
                );
            }

            const existingUser = await prisma.user.findUnique({
                where: {
                    username,
                },
            });

            if (existingUser) {
                return apiError(
                    c,
                    "User with same username already exists",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            // Block collision with E.164 or legacy bare national (India)
            const existingUserWithMobile = await prisma.user.findFirst({
                where: {
                    OR: [
                        { mobileNumber: e164 },
                        ...(countryCode === "91"
                            ? [{ mobileNumber: mob }]
                            : []),
                    ],
                },
            });

            if (existingUserWithMobile) {
                return apiError(
                    c,
                    "User with same mobile already exists",
                    HTTP_STATUS.BAD_REQUEST
                );
            }
            // test


            // Compulsory invite: any referralCode present in DB is valid
            // (no banned / demo / admin filters — product decision)
            const invite = referredBy.trim();
            const referrer = await prisma.user.findUnique({
                where: {
                    referralCode: invite,
                },
                select: { id: true, referralCode: true },
            });

            if (!referrer) {
                return apiError(
                    c,
                    "Invalid invite code",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            const serialNumber = await generateNextSerialNumber();
            const referralCode = createReferralCode(serialNumber);

            // Signup bonus ₹30 for phone registration only — email register gets ₹0
            const signupBonus = targetEmail ? 0 : 30;

            const user = await prisma.user.create({
                data: {
                    serialNumber,
                    username,
                    mobileNumber: e164,
                    email: targetEmail,
                    balance: signupBonus,
                    password: createHash("md5").update(password).digest("hex"),
                    referralCode,
                    referredBy: invite,
                    ip,
                },
            });

            const token = await generateToken(user);

            setCookie(c, AUTH_COOKIE_NAME, token, authCookieOptions());

            // Start day-1 attendance streak for new accounts
            void recordDailyLogin(user.id).catch((err) =>
                logger.error("recordDailyLogin failed on register", err)
            );

            // Log IP activity for successful registration
            if (ip) {
                logIpActivity({
                    ip,
                    userId: user.id,
                    activityType: IpActivityType.REGISTER,
                    metadata: { mobileNumber: mob, email: targetEmail, referredBy },
                });
            }

            return c.json({ success: true, token }, HTTP_STATUS.OK);
        } catch (error) {
            logger.error(error);
            return apiError(
                c,
                "Internal server error",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.openapi(LogoutRoute, async (c) => {
        try {
            deleteCookie(c, AUTH_COOKIE_NAME, authCookieOptions());

            return c.json({ success: true }, HTTP_STATUS.OK);
        } catch (error) {
            logger.error(error);
            return apiError(
                c,
                "Internal server error",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.openapi(ForgotRoute, async (c) => {
        try {
            const { password, countryCode, mobileNumber, otp } =
                c.req.valid("json");
            const e164 = buildE164(countryCode || "91", mobileNumber);

            let user = await prisma.user.findUnique({
                where: { mobileNumber: e164 },
            });
            if (!user && countryCode === "91") {
                user = await prisma.user.findUnique({
                    where: { mobileNumber },
                });
            }

            if (!user) {
                return apiError(
                    c,
                    "User does not exist",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            if (!(await verifyOtp(e164, otp))) {
                // Legacy OTP may have been stored under bare national (pre multi-country)
                if (
                    countryCode !== "91" ||
                    !(await verifyOtp(mobileNumber, otp))
                ) {
                    return apiError(
                        c,
                        "Invalid or expired OTP",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }
            }

            await prisma.user.update({
                where: {
                    id: user.id,
                },
                data: {
                    password: createHash("md5").update(password).digest("hex"),
                },
            });

            return c.json({ success: true }, HTTP_STATUS.OK);
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
