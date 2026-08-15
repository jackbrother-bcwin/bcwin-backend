import { z } from "@hono/zod-openapi";

import { AUTH_COOKIE_NAME } from "../lib/auth";
import {
    COUNTRY_PHONE_RULES,
    SMS_OTP_COUNTRY_CODES,
    digitsOnly,
    getCountryRule,
    isRegisterCountryCode,
    isSmsOtpCountryCode,
    buildE164,
} from "../lib/countryPhone";

/**
 * National mobile digits (no country code).
 * Length validated together with countryCode where both are present.
 */
export const mobileNumber = z
    .string()
    .transform((val) => digitsOnly(val))
    .pipe(
        z
            .string()
            .min(6, { message: "Phone number is too short" })
            .max(15, { message: "Phone number is too long" })
    )
    .openapi({
        description: "National mobile number digits only (no country code)",
        example: "9876543210",
    });

/**
 * Any major-market dialing code (register / login storage).
 * SMS OTP still restricted separately to SMS_OTP_COUNTRY_CODES.
 */
export const countryCodeSchema = z
    .string()
    .transform((v) => digitsOnly(v))
    .refine((v) => isRegisterCountryCode(v), {
        message: "Unsupported country code",
    })
    .openapi({
        description:
            "ITU country dialing code (digits only). Major markets supported for register.",
        example: "91",
    });

/** Strict codes that can receive SMS OTP (Laaffic) */
export const smsCountryCodeSchema = z
    .string()
    .transform((v) => digitsOnly(v))
    .refine((v) => isSmsOtpCountryCode(v), {
        message: `SMS OTP only supports: ${SMS_OTP_COUNTRY_CODES.join(", ")}`,
    })
    .openapi({
        description: "Country code for SMS OTP (91|92|880)",
        example: "91",
    });

/**
 * Pair countryCode + national number → validated E.164 digits.
 */
export const phoneWithCountrySchema = z
    .object({
        countryCode: countryCodeSchema,
        mobileNumber,
    })
    .superRefine((val, ctx) => {
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
    })
    .transform((val) => ({
        countryCode: val.countryCode,
        mobileNumber: val.mobileNumber,
        e164: buildE164(val.countryCode, val.mobileNumber),
    }));

export type PhoneWithCountry = {
    countryCode: string;
    mobileNumber: string;
    e164: string;
};

export const authCookie = z.object({
    [AUTH_COOKIE_NAME]: z.string().openapi({
        description:
            "JWT token for authentication. This will be automatically set for authenticated users",
        example: "1234567890",
    }),
});

// re-export for convenience
export { COUNTRY_PHONE_RULES, SMS_OTP_COUNTRY_CODES };
