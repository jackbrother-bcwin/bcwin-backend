/**
 * Lucky Spin recharge → spins. Highest matching tier only (not stacked).
 * Thresholds live in LuckySpinRule (kind LUCKY); these are the product defaults.
 */

export const LUCKY_SPINS_AWARDED_KEY = "luckySpinsAwarded";

export const DEFAULT_LUCKY_SPIN_RULES: ReadonlyArray<{
    minDeposit: number;
    spinChances: number;
}> = [
    { minDeposit: 200, spinChances: 1 },
    { minDeposit: 500, spinChances: 1 },
    { minDeposit: 1000, spinChances: 1 },
    { minDeposit: 2000, spinChances: 1 },
    { minDeposit: 5000, spinChances: 1 },
    { minDeposit: 10000, spinChances: 2 },
    { minDeposit: 30000, spinChances: 3 },
    { minDeposit: 50000, spinChances: 5 },
    { minDeposit: 100000, spinChances: 5 },
];

export type LuckySpinTier = {
    minDeposit: number;
    spinChances: number;
};

/** Spins for one SUCCESS recharge. Below the lowest tier → 0. */
export function spinsForDepositAmount(
    amount: number,
    rules: ReadonlyArray<LuckySpinTier>
): number {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    let bestMin = -1;
    let bestSpins = 0;
    for (const r of rules) {
        const min = Number(r.minDeposit);
        const n = Math.max(0, Math.floor(Number(r.spinChances) || 0));
        if (!Number.isFinite(min) || amount < min) continue;
        if (min >= bestMin) {
            bestMin = min;
            bestSpins = n;
        }
    }
    return bestSpins;
}

export function readLuckySpinsAwarded(metadata: unknown): number | null {
    if (metadata == null || typeof metadata !== "object" || Array.isArray(metadata)) {
        return null;
    }
    if (!Object.prototype.hasOwnProperty.call(metadata, LUCKY_SPINS_AWARDED_KEY)) {
        return null;
    }
    const n = Number(
        (metadata as Record<string, unknown>)[LUCKY_SPINS_AWARDED_KEY]
    );
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
}

export function mergeLuckySpinsAwarded(
    metadata: unknown,
    spins: number
): Record<string, unknown> {
    const base =
        metadata != null &&
        typeof metadata === "object" &&
        !Array.isArray(metadata)
            ? { ...(metadata as Record<string, unknown>) }
            : {};
    base[LUCKY_SPINS_AWARDED_KEY] = Math.max(0, Math.floor(spins));
    return base;
}
