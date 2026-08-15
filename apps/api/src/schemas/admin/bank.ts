import { z } from "@hono/zod-openapi";

export const searchUserBankQuerySchema = z.object({
    search: z.string().openapi({
        description: "Search by user ID, username, or mobile number",
        example: "1001",
    }),
});

export const updateBankDetailsSchema = z.object({
    fullName: z.string().optional().nullable().openapi({
        description: "Account holder full name",
        example: "John Doe",
    }),
    bankName: z.string().optional().nullable().openapi({
        description: "Bank name",
        example: "Chase Bank",
    }),
    accountType: z.string().optional().nullable().openapi({
        description: "Account Type (e.g., Checking, Savings)",
        example: "Savings",
    }),
    bankAccount: z.string().optional().nullable().openapi({
        description: "Bank Account Number",
        example: "123456789",
    }),
    ifsc: z.string().optional().nullable().openapi({
        description: "IFSC Code / Routing Number",
        example: "CHAS12345",
    }),
    upiId: z.string().optional().nullable().openapi({
        description: "UPI ID",
        example: "john@upi",
    }),
    trc20Address: z
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
            example: "TXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        }),
    bep20Address: z
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
        }),
});
