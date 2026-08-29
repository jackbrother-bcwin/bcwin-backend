import { z } from "@hono/zod-openapi";

export const BANK_ACCOUNT_PATTERN = /^\d{8,20}$/;
export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const RECIPIENT_NAME_PATTERN = /^(?=.*\p{L})[\p{L}\p{M} .'-]+$/u;
export const UPI_ID_PATTERN =
    /^(?=.{3,50}$)[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
export const TRC20_ADDRESS_PATTERN = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
export const BEP20_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export function normalizeIfsc(value: string): string {
    return value.trim().toUpperCase();
}

export function isValidBankAccount(value: string | null | undefined): boolean {
    return BANK_ACCOUNT_PATTERN.test(value?.trim() ?? "");
}

export function isValidIfsc(value: string | null | undefined): boolean {
    return IFSC_PATTERN.test(normalizeIfsc(value ?? ""));
}

export function isValidRecipientName(value: string | null | undefined): boolean {
    const normalized = value?.trim() ?? "";
    return (
        normalized.length >= 3 &&
        normalized.length <= 100 &&
        RECIPIENT_NAME_PATTERN.test(normalized)
    );
}

export function isValidBankName(value: string | null | undefined): boolean {
    const normalized = value?.trim() ?? "";
    return normalized.length >= 2 && normalized.length <= 120;
}

export function isValidUpiId(value: string | null | undefined): boolean {
    return UPI_ID_PATTERN.test(value?.trim() ?? "");
}

export function isValidTrc20Address(
    value: string | null | undefined
): boolean {
    return TRC20_ADDRESS_PATTERN.test(value?.trim() ?? "");
}

export function isValidBep20Address(
    value: string | null | undefined
): boolean {
    return BEP20_ADDRESS_PATTERN.test(value?.trim() ?? "");
}

export const fullNameSchema = z
    .string()
    .trim()
    .min(3, "Recipient name must be at least 3 characters")
    .max(100, "Recipient name must be at most 100 characters")
    .regex(
        RECIPIENT_NAME_PATTERN,
        "Recipient name may only contain letters, spaces, periods, apostrophes and hyphens"
    )
    .optional()
    .nullable()
    .openapi({
        description: "The full name of the account holder",
        example: "John Doe",
    });

export const bankAccountSchema = z
    .string()
    .trim()
    .regex(BANK_ACCOUNT_PATTERN, "Bank account number must be 8 to 20 digits")
    .optional()
    .nullable()
    .openapi({
        description: "Bank account number (8 to 20 digits)",
        example: "001234567890",
    });

export const ifscSchema = z
    .string()
    .trim()
    .toUpperCase()
    .regex(
        IFSC_PATTERN,
        "IFSC must be 11 characters: 4 letters, 0, then 6 letters or digits"
    )
    .optional()
    .nullable()
    .openapi({
        description: "11-character Indian Financial System Code",
        example: "HDFC0000001",
    });

export const upiIdSchema = z
    .string()
    .trim()
    .regex(
        UPI_ID_PATTERN,
        "UPI ID must be 3 to 50 characters in name@handle format without spaces"
    )
    .optional()
    .nullable()
    .openapi({
        description: "UPI virtual payment address",
        example: "john.doe@upi",
    });

export const bankNameSchema = z
    .string()
    .trim()
    .min(2, "Bank name must be at least 2 characters")
    .max(120, "Bank name must be at most 120 characters")
    .optional()
    .nullable()
    .openapi({
        description: "Bank name",
        example: "STATE BANK OF INDIA",
    });

export const trc20AddressSchema = z
    .string()
    .trim()
    .regex(
        TRC20_ADDRESS_PATTERN,
        "Invalid TRC20 address — must start with T (34 chars)"
    )
    .optional()
    .nullable()
    .openapi({
        description: "TRC20 USDT wallet address",
        example: "TRWdq1fs8DhMR8EMJX2iD5qp5jaPuaVyaR",
    });

export const bep20AddressSchema = z
    .string()
    .trim()
    .regex(
        BEP20_ADDRESS_PATTERN,
        "Invalid BEP20 address — must start with 0x (42 chars)"
    )
    .optional()
    .nullable()
    .openapi({
        description: "BEP20 USDT wallet address",
        example: "0x1234567890abcdef1234567890abcdef12345678",
    });

export const bankDetailsFields = {
    fullName: fullNameSchema,
    bankAccount: bankAccountSchema,
    ifsc: ifscSchema,
    trc20Address: trc20AddressSchema,
    bep20Address: bep20AddressSchema,
    upiId: upiIdSchema,
    bankName: bankNameSchema,
};

export type ValidatedBankFieldKey = keyof typeof bankDetailsFields;

export const BANK_FIELD_KEYS = [
    "fullName",
    "bankAccount",
    "ifsc",
    "trc20Address",
    "bep20Address",
    "upiId",
    "bankName",
] as const satisfies readonly ValidatedBankFieldKey[];

export type BankFieldKey = (typeof BANK_FIELD_KEYS)[number];

export function isValidStoredBankField(
    key: ValidatedBankFieldKey,
    value: string | null | undefined
): boolean {
    switch (key) {
        case "fullName":
            return isValidRecipientName(value);
        case "bankAccount":
            return isValidBankAccount(value);
        case "ifsc":
            return isValidIfsc(value);
        case "trc20Address":
            return isValidTrc20Address(value);
        case "bep20Address":
            return isValidBep20Address(value);
        case "upiId":
            return isValidUpiId(value);
        case "bankName":
            return isValidBankName(value);
    }
}

function normalizedBankValue(key: BankFieldKey, value: unknown): string {
    if (value == null) return "";
    const normalized = String(value).trim();
    return key === "ifsc" ? normalized.toUpperCase() : normalized;
}

/**
 * Empty fields may always be filled. During cooldown, an existing malformed value
 * may be replaced only when every changed saved field is malformed and becomes valid.
 */
export function classifyBankWrite(
    existing: Partial<Record<BankFieldKey, string | null | undefined>>,
    incoming: Partial<Record<BankFieldKey, string | null | undefined>>
): { hasChange: boolean; invalidLegacyCorrectionOnly: boolean } {
    let hasChange = false;
    const changedExistingKeys: BankFieldKey[] = [];
    for (const key of BANK_FIELD_KEYS) {
        if (incoming[key] === undefined) continue;
        const oldValue = normalizedBankValue(key, existing[key]);
        const newValue = normalizedBankValue(key, incoming[key]);
        if (oldValue === newValue) continue;
        if (oldValue !== "") {
            hasChange = true;
            changedExistingKeys.push(key);
        }
    }

    const invalidLegacyCorrectionOnly =
        changedExistingKeys.length > 0 &&
        changedExistingKeys.every(
            (key) =>
                !isValidStoredBankField(key, existing[key]) &&
                isValidStoredBankField(key, incoming[key])
        );

    return { hasChange, invalidLegacyCorrectionOnly };
}
