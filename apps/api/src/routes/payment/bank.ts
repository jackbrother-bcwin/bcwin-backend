import { createRoute, RouteConfig, OpenAPIHono, z } from "@hono/zod-openapi";

import { prisma, Prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { apiError, CommonResponses } from "@/lib/utils";
import { HTTP_STATUS } from "@/lib/http";
import { authCookie } from "@/schemas";
import { Cache, CacheKey } from "@bcwin/cache";

const logger = new Logger("bank");

const createBankRoute = <T extends RouteConfig>(config: T) => {
    return createRoute({
        tags: ["payment"],
        ...config,
    });
};

const fullName = z.string().min(3).max(20).optional().nullable().openapi({
    description: "The full name of the account holder",
    example: "John Doe",
});

const bankAccount = z.string().min(8).max(20).optional().nullable().openapi({
    description: "The account number",
    example: "1234567890",
});

const ifsc = z.string().min(6).max(15).optional().nullable().openapi({
    description: "The IFSC code",
    example: "HDFC0000001",
});

const trc20Address = z
    .string()
    .optional()
    .nullable()
    .refine(
        (v) => {
            if (v == null || v === "") return true;
            const s = v.trim();
            return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s);
        },
        {
            message: "Invalid TRC20 address — must start with T (34 chars)",
        }
    )
    .openapi({
        description: "TRC20 USDT wallet address",
        example: "TRWdq1fs8DhMR8EMJX2iD5qp5jaPuaVyaR",
    });

const bep20Address = z
    .string()
    .optional()
    .nullable()
    .refine(
        (v) => {
            if (v == null || v === "") return true;
            const s = v.trim();
            return /^0x[a-fA-F0-9]{40}$/.test(s);
        },
        {
            message: "Invalid BEP20 address — must start with 0x (42 chars)",
        }
    )
    .openapi({
        description: "BEP20 USDT wallet address",
        example: "0x1234567890abcdef1234567890abcdef12345678",
    });

const upiId = z.string().optional().nullable().openapi({
    description: "The UPI ID",
    example: "john.doe@upi",
});

const bankName = z.string().min(2).max(120).optional().nullable().openapi({
    description: "Bank name",
    example: "STATE BANK OF INDIA",
});

const otpCode = z.coerce
    .string()
    .regex(/^\d{6}$/, "OTP must be a 6-digit number")
    .openapi({
        description: "6-digit OTP sent to the registered mobile number",
        example: "123456",
    });

const PostBankSchema = z.object({
    fullName,
    bankAccount,
    ifsc,
    trc20Address,
    bep20Address,
    upiId,
    bankName,
    otp: otpCode,
});

const GetBankResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the bank details retrieval was successful",
        example: true,
    }),
    data: z
        .object({
            fullName,
            bankAccount,
            ifsc,
            trc20Address,
            bep20Address,
            upiId,
            bankName,
            updatedAt: z.string().datetime().optional().nullable().openapi({
                description: "Last time bank details were saved/updated (ISO)",
            }),
            canUpdate: z.boolean().optional().openapi({
                description:
                    "Whether already-saved fields may be changed (24h cooldown). Empty fields can still be added.",
            }),
            nextUpdateAt: z.string().datetime().optional().nullable().openapi({
                description:
                    "Earliest time another update is allowed (null if can update now)",
            }),
        })
        .openapi({
            description: "The bank details",
        }),
});

const PostBankResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the bank details were saved successfully",
        example: true,
    }),
});

const GetBankRoute = createBankRoute({
    method: "get",
    path: "/bank",
    summary: "Get the bank details",
    description: "Get the bank details of the user",
    request: {
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: GetBankResponseSchema,
                },
            },
            description: "Bank details retrieved successfully",
        },
        ...CommonResponses.notFound(),
        ...CommonResponses.internalServerError(),
    },
});

const PostBankRoute = createBankRoute({
    method: "post",
    path: "/bank",
    summary: "Save the bank details",
    description: "Save the bank details of the user",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: PostBankSchema,
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: PostBankResponseSchema,
                },
            },
            description: "Bank details saved successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

const PatchBankRoute = createBankRoute({
    method: "patch",
    path: "/bank",
    summary: "Update the bank details",
    description: "Update the bank details of the user",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: PostBankSchema,
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: PostBankResponseSchema,
                },
            },
            description: "Bank details updated successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.notFound(),
        ...CommonResponses.internalServerError(),
    },
});

type BankReturn = z.infer<typeof GetBankResponseSchema>["data"];

/** Min interval between bank detail updates (24 hours) */
const BANK_UPDATE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const setCache = async (userId: string, bankDetails: BankReturn) => {
    await Cache.set<BankReturn>(
        CacheKey.bank(userId),
        bankDetails,
        2 * 24 * 60 * 60
    ); // 2 days
};

type BankOtpChannel = "email" | "mobile";

/**
 * OTP rows for SMS are stored under E.164 (e.g. 919876543210) by GET /otp.
 * User.mobileNumber may be E.164 (new accounts) or legacy bare national (10-digit India).
 * Bank FE also re-parses stored mobile → sends OTP under E.164 — verify must try all forms.
 */
function mobileOtpLookupKeys(stored: string | null | undefined): string[] {
    if (!stored) return [];
    const raw = stored.trim();
    if (!raw) return [];
    const d = raw.replace(/\D/g, "");
    const keys = new Set<string>();
    keys.add(raw);
    if (d) keys.add(d);

    // Legacy bare national ↔ E.164 for SMS countries (91 / 92 / 880)
    if (d.length === 10) {
        keys.add(`91${d}`);
        keys.add(`92${d}`);
    }
    if (d.startsWith("91") && d.length === 12) keys.add(d.slice(2));
    if (d.startsWith("92") && d.length === 12) keys.add(d.slice(2));
    if (d.startsWith("880") && d.length >= 12) {
        keys.add(d.slice(3));
        // national 10 digits under 880
        if (d.length === 13) keys.add(d.slice(3));
    }
    if (d.length === 10) keys.add(`880${d}`);

    return [...keys].filter(Boolean);
}

/**
 * Verify bank OTP against the authenticated user's contact only.
 * Prefer email when present (email-primary registration), else mobile.
 * Matches register/forgot: SMS OTP key is E.164, not necessarily User.mobileNumber raw.
 */
async function verifyBankOtp(
    user: {
        id?: string;
        mobileNumber?: string | null;
        email?: string | null;
    },
    otp: string
): Promise<{ ok: boolean; channel?: BankOtpChannel; otpId?: string }> {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const code = String(otp).trim();

    const email = user.email?.trim().toLowerCase() || null;
    if (email) {
        const byEmail = await prisma.otp.findFirst({
            where: {
                email,
                otp: code,
                updatedAt: { gte: fiveMinutesAgo },
            },
        });
        if (byEmail) return { ok: true, channel: "email", otpId: byEmail.id };
    }

    const mobileKeys = mobileOtpLookupKeys(user.mobileNumber);
    if (mobileKeys.length > 0) {
        const byMobile = await prisma.otp.findFirst({
            where: {
                mobileNumber: { in: mobileKeys },
                otp: code,
                updatedAt: { gte: fiveMinutesAgo },
            },
        });
        if (byMobile) return { ok: true, channel: "mobile", otpId: byMobile.id };
    }

    logger.warn("[BANK_OTP_FAIL] No matching OTP", {
        userId: user.id,
        hasEmail: Boolean(email),
        mobileKeys,
        // do not log the code itself
    });

    return { ok: false };
}

async function consumeBankOtp(
    user: { mobileNumber?: string | null; email?: string | null },
    channel?: BankOtpChannel,
    otpId?: string
) {
    // Prefer deleting the exact row that matched
    if (otpId) {
        await prisma.otp
            .deleteMany({ where: { id: otpId } })
            .catch(() => undefined);
        return;
    }

    if (channel === "email" && user.email) {
        await prisma.otp
            .deleteMany({ where: { email: user.email.trim().toLowerCase() } })
            .catch(() => undefined);
        return;
    }

    const mobileKeys = mobileOtpLookupKeys(user.mobileNumber);
    if (mobileKeys.length > 0) {
        await prisma.otp
            .deleteMany({ where: { mobileNumber: { in: mobileKeys } } })
            .catch(() => undefined);
    }
    if (user.email) {
        await prisma.otp
            .deleteMany({ where: { email: user.email.trim().toLowerCase() } })
            .catch(() => undefined);
    }
}

function updateCooldown(updatedAt: Date | null | undefined): {
    canUpdate: boolean;
    nextUpdateAt: string | null;
} {
    if (!updatedAt) {
        return { canUpdate: true, nextUpdateAt: null };
    }
    const next = updatedAt.getTime() + BANK_UPDATE_COOLDOWN_MS;
    if (Date.now() >= next) {
        return { canUpdate: true, nextUpdateAt: null };
    }
    return { canUpdate: false, nextUpdateAt: new Date(next).toISOString() };
}

const BANK_FIELD_KEYS = [
    "fullName",
    "bankAccount",
    "ifsc",
    "trc20Address",
    "bep20Address",
    "upiId",
    "bankName",
] as const;

type BankFieldKey = (typeof BANK_FIELD_KEYS)[number];

function normBankVal(v: unknown): string {
    if (v == null) return "";
    return String(v).trim();
}

/**
 * First-time fill of empty fields is always allowed (bank then USDT, etc.).
 * Cooldown applies only when changing or clearing a value that was already set.
 */
function classifyBankWrite(
    existing: Partial<Record<BankFieldKey, string | null | undefined>>,
    incoming: Partial<Record<BankFieldKey, string | null | undefined>>
): { hasChange: boolean } {
    let hasChange = false;
    for (const key of BANK_FIELD_KEYS) {
        if (incoming[key] === undefined) continue;
        const oldV = normBankVal(existing[key]);
        const newV = normBankVal(incoming[key]);
        if (oldV === newV) continue;
        if (oldV !== "") hasChange = true;
    }
    return { hasChange };
}

export const bankRoutes = (app: OpenAPIHono) => {
    app.openapi(GetBankRoute, async (c) => {
        try {
            const user = c.get("user");

            // Always read from DB so admin edits are visible immediately
            const bankDetails = await prisma.bank.findUnique({
                where: {
                    userId: user.id,
                },
                select: {
                    fullName: true,
                    bankAccount: true,
                    ifsc: true,
                    trc20Address: true,
                    bep20Address: true,
                    upiId: true,
                    bankName: true,
                    updatedAt: true,
                },
            });

            if (!bankDetails) {
                return apiError(
                    c,
                    "Bank details not found",
                    HTTP_STATUS.NOT_FOUND
                );
            }

            const cooldown = updateCooldown(bankDetails.updatedAt);
            const payload: BankReturn = {
                fullName: bankDetails.fullName,
                bankAccount: bankDetails.bankAccount,
                ifsc: bankDetails.ifsc,
                trc20Address: bankDetails.trc20Address,
                bep20Address: bankDetails.bep20Address,
                upiId: bankDetails.upiId,
                bankName: bankDetails.bankName,
                updatedAt: bankDetails.updatedAt.toISOString(),
                canUpdate: user.isDemo ? true : cooldown.canUpdate,
                nextUpdateAt: user.isDemo ? null : cooldown.nextUpdateAt,
            };

            await setCache(user.id, {
                fullName: payload.fullName,
                bankAccount: payload.bankAccount,
                ifsc: payload.ifsc,
                trc20Address: payload.trc20Address,
                bep20Address: payload.bep20Address,
                upiId: payload.upiId,
                bankName: payload.bankName,
            });

            return c.json(
                {
                    success: true,
                    data: payload,
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

    app.openapi(PostBankRoute, async (c) => {
        try {
            const {
                fullName,
                bankAccount,
                ifsc,
                trc20Address,
                bep20Address,
                upiId,
                bankName,
                otp,
            } = c.req.valid("json");
            const user = c.get("user");

            let otpCheck: { ok: boolean; channel?: BankOtpChannel; otpId?: string } = { ok: true };
            if (!user.isDemo) {
                if (!user.email && !user.mobileNumber) {
                    return apiError(
                        c,
                        "No email or mobile on account. Cannot verify OTP.",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }

                otpCheck = await verifyBankOtp(user, otp);
                if (!otpCheck.ok) {
                    return apiError(
                        c,
                        "Invalid or expired OTP",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }
            }

            const existingBankDetails = await prisma.bank.findUnique({
                where: {
                    userId: user.id,
                },
            });

            if (existingBankDetails) {
                if (user.isDemo) {
                    const dataToUpdate: Prisma.BankUpdateInput = {};
                    if (fullName !== undefined) dataToUpdate.fullName = fullName;
                    if (bankAccount !== undefined) dataToUpdate.bankAccount = bankAccount;
                    if (ifsc !== undefined) dataToUpdate.ifsc = ifsc;
                    if (trc20Address !== undefined) dataToUpdate.trc20Address = trc20Address;
                    if (bep20Address !== undefined) dataToUpdate.bep20Address = bep20Address;
                    if (upiId !== undefined) dataToUpdate.upiId = upiId;
                    if (bankName !== undefined) dataToUpdate.bankName = bankName;

                    const updated = await prisma.bank.update({
                        where: { userId: user.id },
                        data: dataToUpdate,
                        select: {
                            fullName: true,
                            bankAccount: true,
                            ifsc: true,
                            trc20Address: true,
                            bep20Address: true,
                            upiId: true,
                            bankName: true,
                        },
                    });
                    await setCache(user.id, updated);
                    return c.json({ success: true }, HTTP_STATUS.OK);
                }
                return apiError(
                    c,
                    "Bank details already exist",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            const bankDetails = await prisma.bank.create({
                data: {
                    userId: user.id,
                    fullName,
                    bankAccount,
                    ifsc,
                    trc20Address,
                    bep20Address,
                    upiId,
                    bankName,
                },
                select: {
                    fullName: true,
                    bankAccount: true,
                    ifsc: true,
                    trc20Address: true,
                    bep20Address: true,
                    upiId: true,
                    bankName: true,
                },
            });

            await setCache(user.id, bankDetails);

            if (!user.isDemo) {
                // Consume OTP after successful use
                await consumeBankOtp(user, otpCheck.channel, otpCheck.otpId);
            }

            return c.json(
                {
                    success: true,
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

    app.openapi(PatchBankRoute, async (c) => {
        try {
            const {
                fullName,
                bankAccount,
                ifsc,
                trc20Address,
                bep20Address,
                upiId,
                bankName,
                otp,
            } = c.req.valid("json");
            const user = c.get("user");

            let otpCheck: { ok: boolean; channel?: BankOtpChannel; otpId?: string } = { ok: true };
            if (!user.isDemo) {
                if (!user.email && !user.mobileNumber) {
                    return apiError(
                        c,
                        "No email or mobile on account. Cannot verify OTP.",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }

                otpCheck = await verifyBankOtp(user, otp);
                if (!otpCheck.ok) {
                    return apiError(
                        c,
                        "Invalid or expired OTP",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }
            }

            const existing = await prisma.bank.findUnique({
                where: { userId: user.id },
            });

            if (!existing) {
                if (user.isDemo) {
                    const bankDetails = await prisma.bank.create({
                        data: {
                            userId: user.id,
                            fullName,
                            bankAccount,
                            ifsc,
                            trc20Address,
                            bep20Address,
                            upiId,
                            bankName,
                        },
                        select: {
                            fullName: true,
                            bankAccount: true,
                            ifsc: true,
                            trc20Address: true,
                            bep20Address: true,
                            upiId: true,
                            bankName: true,
                        },
                    });
                    await setCache(user.id, bankDetails);
                    return c.json({ success: true }, HTTP_STATUS.OK);
                }
                return apiError(
                    c,
                    "Bank details not found. Please add them first.",
                    HTTP_STATUS.NOT_FOUND
                );
            }

            const { hasChange } = classifyBankWrite(existing, {
                fullName,
                bankAccount,
                ifsc,
                trc20Address,
                bep20Address,
                upiId,
                bankName,
            });

            const cooldown = updateCooldown(existing.updatedAt);
            if (!user.isDemo && hasChange && !cooldown.canUpdate) {
                return apiError(
                    c,
                    `Saved details can only be changed once every 24 hours. You can still add missing bank / UPI / USDT. Try changing after ${cooldown.nextUpdateAt}`,
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            const dataToUpdate: Prisma.BankUpdateInput = {};

            if (fullName !== undefined) dataToUpdate.fullName = fullName;
            if (bankAccount !== undefined)
                dataToUpdate.bankAccount = bankAccount;
            if (ifsc !== undefined) dataToUpdate.ifsc = ifsc;
            if (trc20Address !== undefined)
                dataToUpdate.trc20Address = trc20Address;
            if (bep20Address !== undefined)
                dataToUpdate.bep20Address = bep20Address;
            if (upiId !== undefined) dataToUpdate.upiId = upiId;
            if (bankName !== undefined) dataToUpdate.bankName = bankName;

            const bankDetails = await prisma.bank.update({
                where: {
                    userId: user.id,
                },
                data: dataToUpdate,
                select: {
                    fullName: true,
                    bankAccount: true,
                    ifsc: true,
                    trc20Address: true,
                    bep20Address: true,
                    upiId: true,
                    bankName: true,
                },
            });

            await setCache(user.id, bankDetails);

            if (!user.isDemo) {
                await consumeBankOtp(user, otpCheck.channel, otpCheck.otpId);
            }

            return c.json(
                {
                    success: true,
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
