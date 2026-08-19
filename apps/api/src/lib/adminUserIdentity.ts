/** Shared identity on Admin → Finance lists (ADR-0026). */
export const ADMIN_USER_IDENTITY_SELECT = {
    id: true,
    serialNumber: true,
    username: true,
    mobileNumber: true,
    email: true,
    bank: { select: { fullName: true } },
} as const;

export type AdminUserIdentityRow = {
    id: string;
    serialNumber: number;
    username: string;
    mobileNumber: string;
    email: string | null;
    bank: { fullName: string | null } | null;
};

export function mapAdminUserIdentity(user: {
    id: string;
    serialNumber: number;
    username: string;
    mobileNumber: string;
    email?: string | null;
    bank?: { fullName?: string | null } | null;
}): AdminUserIdentityRow {
    const fullName = user.bank?.fullName?.trim() || null;
    return {
        id: user.id,
        serialNumber: user.serialNumber,
        username: user.username,
        mobileNumber: user.mobileNumber,
        email: user.email ?? null,
        bank: fullName ? { fullName } : null,
    };
}
