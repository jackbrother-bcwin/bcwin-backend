import type { Prisma } from "@bcwin/db";

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SERIAL_PATTERN = /^#\s*(\d+)$/;
const MOBILE_PATTERN = /^\+?[\d\s()-]+$/;

/** Consistent admin lookup across user-facing lists and ledgers. */
export function normalizeAdminUserSearch(value: string | undefined): string {
    return value?.trim() ?? "";
}

function serialNumberFromDigits(value: string): number | null {
    if (!/^\d+$/.test(value)) return null;
    const serial = Number(value);
    return Number.isSafeInteger(serial) && serial <= 2_147_483_647
        ? serial
        : null;
}

/** Normalized mobile candidates, including local 10 digits from a +91 input. */
export function adminMobileSearchValues(value: string): string[] {
    const digits = value.replace(/\D/g, "");
    if (!digits) return [];
    return [...new Set([digits, ...(digits.startsWith("91") && digits.length === 12
        ? [digits.slice(2)]
        : [])])];
}

/**
 * Uses an unambiguous admin search syntax:
 * - #1234: exact serial/UID
 * - digits (including formatted +91 input): mobile only
 * - UUID: exact internal user ID
 * - all other text: username, email, or referral code
 */
export function adminUserSearchOr(search: string): Prisma.UserWhereInput[] {
    const value = normalizeAdminUserSearch(search);
    if (!value) return [];

    const serialMatch = value.match(SERIAL_PATTERN);
    if (serialMatch) {
        const serialNumber = serialNumberFromDigits(serialMatch[1]!);
        return serialNumber === null ? [] : [{ serialNumber }];
    }

    // A leading # reserves serial lookup syntax. Invalid serials match nothing.
    if (value.startsWith("#")) return [];

    if (UUID_PATTERN.test(value)) return [{ id: value }];

    if (MOBILE_PATTERN.test(value)) {
        return adminMobileSearchValues(value).map((mobile) => ({
            mobileNumber: { contains: mobile },
        }));
    }

    return [
        { username: { contains: value, mode: "insensitive" } },
        { email: { contains: value, mode: "insensitive" } },
        { referralCode: { contains: value, mode: "insensitive" } },
        { referredBy: { contains: value, mode: "insensitive" } },
    ];
}
