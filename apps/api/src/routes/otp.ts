import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { mobileNumber, smsCountryCodeSchema } from "@/schemas";
import { getCountryRule, isSmsOtpCountryCode, buildE164 } from "@/lib/countryPhone";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import Otp from "@/lib/otp";

const logger = new Logger("otp");

const otpQuerySchema = z
    .object({
        method: z.enum(["mobileNumber", "email"]).default("mobileNumber").openapi({
            description: "Method to send OTP ('mobileNumber' or 'email')",
            example: "mobileNumber",
        }),
        /** SMS only supports 91|92|880 */
        countryCode: smsCountryCodeSchema.default("91"),
        mobileNumber: mobileNumber.optional(),
        email: z.email().optional().openapi({
            description: "Email address when method is 'email'",
            example: "user@example.com",
        }),
        purpose: z.enum(["register", "reset"]).optional().openapi({
            description:
                "register = new account OTP. reset = forgot password (user must already exist).",
            example: "reset",
        }),
    })
    .superRefine((val, ctx) => {
        if (val.method === "mobileNumber") {
            if (!val.mobileNumber) {
                ctx.addIssue({
                    code: "custom",
                    path: ["mobileNumber"],
                    message: "mobileNumber is required when method is mobileNumber",
                });
                return;
            }
            if (!isSmsOtpCountryCode(val.countryCode)) {
                ctx.addIssue({
                    code: "custom",
                    path: ["countryCode"],
                    message: "SMS OTP is not available for this country",
                });
                return;
            }
            const rule = getCountryRule(val.countryCode);
            const n = val.mobileNumber;
            if (rule && (n.length < rule.minLen || n.length > rule.maxLen)) {
                ctx.addIssue({
                    code: "custom",
                    path: ["mobileNumber"],
                    message: `${rule.name} (+${rule.code}) mobile must be ${rule.minLen}${
                        rule.minLen === rule.maxLen ? "" : `–${rule.maxLen}`
                    } digits`,
                });
            }
        } else if (val.method === "email") {
            if (!val.email) {
                ctx.addIssue({
                    code: "custom",
                    path: ["email"],
                    message: "email is required when method is email",
                });
            }
        }
    });

const otpResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the OTP was sent successfully",
        example: true,
    }),
});

const otpRoute = createRoute({
    method: "get",
    path: "/otp",
    summary: "Send OTP SMS or Email",
    description:
        "Send OTP to mobile or email. Method can be 'mobileNumber' or 'email'.",
    request: {
        query: otpQuerySchema,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: otpResponseSchema,
                },
            },
            description: "Send OTP to mobile number or email address",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

export const otpRoutes = (app: OpenAPIHono) => {
    app.openapi(otpRoute, async (c) => {
        try {
            const query = c.req.valid("query");
            const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

            if (query.method === "email" && query.email) {
                const targetEmail = query.email.trim().toLowerCase();

                if (query.purpose === "reset") {
                    const existing = await prisma.user.findUnique({
                        where: { email: targetEmail },
                        select: { id: true },
                    });
                    if (!existing) {
                        return apiError(
                            c,
                            "User does not exist",
                            HTTP_STATUS.BAD_REQUEST
                        );
                    }
                }

                const otpData = await prisma.otp.findFirst({
                    where: {
                        email: targetEmail,
                        updatedAt: {
                            gte: twoMinutesAgo,
                        },
                    },
                });

                if (otpData) {
                    return apiError(
                        c,
                        "Please wait 2 minutes before trying again",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }

                const otp = await Otp.sendEmail(targetEmail);

                await prisma.otp.upsert({
                    where: {
                        email: targetEmail,
                    },
                    create: {
                        email: targetEmail,
                        otp,
                    },
                    update: {
                        otp,
                    },
                });

                return c.json(
                    {
                        success: true,
                    },
                    HTTP_STATUS.OK
                );
            } else {
                const { countryCode, mobileNumber: mob } = query;
                const e164 = buildE164(countryCode, mob!);

                if (query.purpose === "reset") {
                    let existing = await prisma.user.findUnique({
                        where: { mobileNumber: e164 },
                        select: { id: true },
                    });
                    if (!existing && countryCode === "91") {
                        existing = await prisma.user.findUnique({
                            where: { mobileNumber: mob! },
                            select: { id: true },
                        });
                    }
                    if (!existing) {
                        return apiError(
                            c,
                            "User does not exist",
                            HTTP_STATUS.BAD_REQUEST
                        );
                    }
                }

                // Rate-limit by full international number
                const otpData = await prisma.otp.findFirst({
                    where: {
                        mobileNumber: e164,
                        updatedAt: {
                            gte: twoMinutesAgo,
                        },
                    },
                });

                if (otpData) {
                    return apiError(
                        c,
                        "Please wait 2 minutes before trying again",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }

                const otp = await Otp.send(e164);

                await prisma.otp.upsert({
                    where: {
                        mobileNumber: e164,
                    },
                    create: {
                        mobileNumber: e164,
                        otp,
                    },
                    update: {
                        otp,
                    },
                });

                return c.json(
                    {
                        success: true,
                    },
                    HTTP_STATUS.OK
                );
            }
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
