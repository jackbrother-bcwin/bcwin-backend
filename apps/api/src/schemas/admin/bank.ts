import { z } from "@hono/zod-openapi";
import { bankDetailsFields } from "../bankDetails";

export const searchUserBankQuerySchema = z.object({
    search: z.string().openapi({
        description: "Search by mobile, username, UUID, or exact serial prefixed with #",
        example: "#1001",
    }),
});

export const updateBankDetailsSchema = z.object({
    ...bankDetailsFields,
    accountType: z.string().optional().nullable().openapi({
        description: "Account Type (e.g., Checking, Savings)",
        example: "Savings",
    }),
});
