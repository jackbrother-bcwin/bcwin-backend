import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import { prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import { searchUserBankQuerySchema, updateBankDetailsSchema } from "../../schemas/admin/bank";

const logger = new Logger("admin-bank-details");

const BankResponseSchema = z.object({
    id: z.string(),
    userId: z.string(),
    bankName: z.string().nullable(),
    accountType: z.string().nullable(),
    bankAccount: z.string().nullable(),
    ifsc: z.string().nullable(),
    trc20Address: z.string().nullable(),
    bep20Address: z.string().nullable(),
    upiId: z.string().nullable(),
    fullName: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

const UserBankResponseSchema = z.object({
    id: z.string(),
    serialNumber: z.number(),
    username: z.string(),
    mobileNumber: z.string(),
    bank: BankResponseSchema.nullable(),
});

// Search user bank details
const searchUserBankRoute = createRoute({
    method: "get",
    path: "/search",
    tags: ["admin"],
    summary: "Search user bank details",
    description: "Search user by ID (serial number), username, or mobile number to get their bank details",
    request: {
        query: searchUserBankQuerySchema,
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        user: UserBankResponseSchema.nullable(),
                    }),
                },
            },
            description: "User details retrieved successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

// Update or create bank details
const updateBankDetailsRoute = createRoute({
    method: "patch",
    path: "/:userId",
    tags: ["admin"],
    summary: "Update user bank details",
    description: "Upserts the user bank or USDT wallet details",
    request: {
        params: z.object({
            userId: z.string().openapi({ description: "User ID (UUID) to update" }),
        }),
        body: {
            content: {
                "application/json": { schema: updateBankDetailsSchema },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        message: z.string(),
                        bank: BankResponseSchema,
                    }),
                },
            },
            description: "Bank details updated successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

export const adminBankRoutes = (app: OpenAPIHono) => {
    // Search user bank
    app.openapi(searchUserBankRoute, async (c) => {
        try {
            const { search } = c.req.valid("query");

            // Build search filter: serialNumber, username, or mobileNumber
            const serialNum = parseInt(search);
            const userFilter = {
                OR: [
                    ...(isNaN(serialNum) ? [] : [{ serialNumber: serialNum }]),
                    { username: { contains: search, mode: "insensitive" as const } },
                    { mobileNumber: { contains: search } },
                    { id: search } // Try exact matching UUID as fallback
                ],
            };

            const user = await prisma.user.findFirst({
                where: userFilter,
                select: {
                    id: true,
                    serialNumber: true,
                    username: true,
                    mobileNumber: true,
                    bank: true,
                },
            });

            if (!user) {
                return c.json({ success: true, user: null }, HTTP_STATUS.OK);
            }

            // Normalize response
            const responseData = {
                id: user.id,
                serialNumber: user.serialNumber,
                username: user.username,
                mobileNumber: user.mobileNumber,
                bank: user.bank ? {
                    ...user.bank,
                    createdAt: user.bank.createdAt.toISOString(),
                    updatedAt: user.bank.updatedAt.toISOString(),
                } : null,
            };

            return c.json({ success: true, user: responseData }, HTTP_STATUS.OK);
        } catch (error) {
            logger.error("Error searching user bank:", error);
            return apiError(c, "Internal server error", HTTP_STATUS.INTERNAL_SERVER_ERROR);
        }
    });

    // Update bank details
    app.openapi(updateBankDetailsRoute, async (c) => {
        try {
            const { userId } = c.req.valid("param");
            const updates = c.req.valid("json");

            const user = await prisma.user.findUnique({
                where: { id: userId },
                include: { bank: true }
            });

            if (!user) {
                return apiError(c, "User not found", HTTP_STATUS.BAD_REQUEST);
            }

            const emptyToNull = (v: string | null | undefined): string | null => {
                if (v == null) return null;
                const t = v.trim();
                return t === "" ? null : t;
            };

            const cleanUpdates: Record<string, string | null> = {};
            if (updates.fullName !== undefined)
                cleanUpdates.fullName = emptyToNull(updates.fullName);
            if (updates.bankName !== undefined)
                cleanUpdates.bankName = emptyToNull(updates.bankName);
            if (updates.accountType !== undefined)
                cleanUpdates.accountType = emptyToNull(updates.accountType);
            if (updates.bankAccount !== undefined)
                cleanUpdates.bankAccount = emptyToNull(updates.bankAccount);
            if (updates.ifsc !== undefined)
                cleanUpdates.ifsc = emptyToNull(updates.ifsc);
            if (updates.upiId !== undefined)
                cleanUpdates.upiId = emptyToNull(updates.upiId);
            if (updates.trc20Address !== undefined)
                cleanUpdates.trc20Address = emptyToNull(updates.trc20Address);
            if (updates.bep20Address !== undefined)
                cleanUpdates.bep20Address = emptyToNull(updates.bep20Address);

            let updatedBank;

            if (user.bank) {
                updatedBank = await prisma.bank.update({
                    where: { userId },
                    data: cleanUpdates,
                });
            } else {
                updatedBank = await prisma.bank.create({
                    data: {
                        userId,
                        ...cleanUpdates,
                    },
                });
            }

            // Drop user bank cache so app GET /payment/bank reflects admin change immediately
            await Cache.del(CacheKey.bank(userId));
            await Cache.set(
                CacheKey.bank(userId),
                {
                    fullName: updatedBank.fullName,
                    bankAccount: updatedBank.bankAccount,
                    ifsc: updatedBank.ifsc,
                    trc20Address: updatedBank.trc20Address,
                    bep20Address: updatedBank.bep20Address,
                    upiId: updatedBank.upiId,
                    bankName: updatedBank.bankName,
                },
                2 * 24 * 60 * 60
            );

            logger.info("Admin updated bank details", { userId });

            return c.json(
                {
                    success: true,
                    message: "Bank details updated successfully",
                    bank: {
                        ...updatedBank,
                        createdAt: updatedBank.createdAt.toISOString(),
                        updatedAt: updatedBank.updatedAt.toISOString(),
                    },
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error updating bank details:", error);
            return apiError(c, "Internal server error", HTTP_STATUS.INTERNAL_SERVER_ERROR);
        }
    });
};
