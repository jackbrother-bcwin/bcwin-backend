// Temporarily disable expiry for these rewards, including legacy unclaimed rows.
export const NON_EXPIRING_BONUS_TYPES = ["DAILY", "INVITATION", "FIRST_DEPOSIT"] as const;

export function isNonExpiringBonus(type: string): boolean {
    return NON_EXPIRING_BONUS_TYPES.some((bonusType) => bonusType === type);
}

// ATTENDENCE matches the enum spelling in the database.
export const EXPIRATION_DAYS = {
    DAILY: null,
    ATTENDENCE: 1,
    WEEKLY: 7,
    INVITATION: null,
    FIRST_DEPOSIT: null,
};

export function calculateExpirationDate(type: string): Date | null {
    if (isNonExpiringBonus(type)) return null;
    const days = EXPIRATION_DAYS[type as keyof typeof EXPIRATION_DAYS] ?? 7;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}
