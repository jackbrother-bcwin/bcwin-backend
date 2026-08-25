/**
 * New gift codes: BCWIN0X + 8 A–Z/0–9. No hyphen.
 * Redeem trims and uppercases; hyphens stay so old YYYYMMDD-… codes still match.
 */

export const GIFT_CODE_PREFIX = "BCWIN0X";
export const GIFT_CODE_SUFFIX_LEN = 8;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CREATE_ATTEMPTS = 8;

export function normalizeGiftCode(raw: string): string {
    return raw.trim().toUpperCase();
}

/** Trim first (legacy / test prefixes), then uppercase (brand codes typed loosely). */
export function giftCodeLookupCandidates(raw: string): string[] {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    const upper = trimmed.toUpperCase();
    if (upper === trimmed) return [trimmed];
    return [trimmed, upper];
}

export function generateGiftCode(): string {
    const bytes = new Uint8Array(GIFT_CODE_SUFFIX_LEN);
    crypto.getRandomValues(bytes);
    let suffix = "";
    for (const b of bytes) {
        suffix += ALPHABET[b % ALPHABET.length]!;
    }
    return `${GIFT_CODE_PREFIX}${suffix}`;
}

export function isBrandGiftCode(code: string): boolean {
    return new RegExp(
        `^${GIFT_CODE_PREFIX}[A-Z0-9]{${GIFT_CODE_SUFFIX_LEN}}$`
    ).test(code);
}

export function isUniqueConstraintError(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        (error as { code?: string }).code === "P2002"
    );
}

export async function mintGiftCode(
    insert: (code: string) => Promise<void>
): Promise<string> {
    let last: unknown;
    for (let i = 0; i < CREATE_ATTEMPTS; i++) {
        const code = generateGiftCode();
        try {
            await insert(code);
            return code;
        } catch (error) {
            last = error;
            if (!isUniqueConstraintError(error)) throw error;
        }
    }
    throw last instanceof Error
        ? last
        : new Error("Could not mint a unique gift code");
}
