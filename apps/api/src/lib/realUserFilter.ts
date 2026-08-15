/**
 * Admin platform stats: only real players.
 * Excludes demo accounts and staff (ADMIN / SUB_ADMIN / AGENT).
 */
export const REAL_USER_WHERE = {
    isDemo: false,
    role: "USER" as const,
};

/** Nested on Deposit / Withdraw / Bet: `where: { user: REAL_USER_WHERE }` */
export const REAL_USER_RELATION = {
    user: REAL_USER_WHERE,
};

/** Nested on BetResult: `where: { bet: { user: REAL_USER_WHERE } }` */
export const REAL_BET_USER_RELATION = {
    bet: { user: REAL_USER_WHERE },
};
