import type { Prisma } from "@bcwin/db";

/** Consistent admin lookup across user-facing lists and ledgers. */
export function normalizeAdminUserSearch(value: string | undefined): string {
    return value?.trim() ?? "";
}

function serialNumberFromSearch(value: string): number | null {
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
 * Matches serial, UUID, username, mobile (including +91/spaced input), email, and
 * referral codes. Callers combine these clauses with their own role/status filters.
 */
export function adminUserSearchOr(search: string): Prisma.UserWhereInput[] {
    const value = normalizeAdminUserSearch(search);
    if (!value) return [];

    const serialNumber = serialNumberFromSearch(value);
    const clauses: Prisma.UserWhereInput[] = [
        { id: value },
        { username: { contains: value, mode: "insensitive" } },
        { email: { contains: value, mode: "insensitive" } },
        { referralCode: { contains: value, mode: "insensitive" } },
        { referredBy: { contains: value, mode: "insensitive" } },
    ];

    const mobileCandidates = adminMobileSearchValues(value);
    for (const mobile of mobileCandidates.length ? mobileCandidates : [value]) {
        clauses.push({ mobileNumber: { contains: mobile } });
    }
    if (serialNumber !== null) clauses.push({ serialNumber });

    return clauses;
}
