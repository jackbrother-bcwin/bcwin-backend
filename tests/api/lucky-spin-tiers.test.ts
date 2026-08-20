/**
 * Lucky Spin recharge tiers — highest match only (ADR-0034).
 */

import { describe, test, expect } from "bun:test";
import {
    DEFAULT_LUCKY_SPIN_RULES,
    mergeLuckySpinsAwarded,
    readLuckySpinsAwarded,
    spinsForDepositAmount,
} from "../../apps/api/src/lib/luckySpinTiers";

const R = DEFAULT_LUCKY_SPIN_RULES;

describe("spinsForDepositAmount (highest Lucky Spin tier)", () => {
    test("below ₹200 is 0", () => {
        expect(spinsForDepositAmount(0, R)).toBe(0);
        expect(spinsForDepositAmount(199, R)).toBe(0);
    });

    test("exact tiers", () => {
        expect(spinsForDepositAmount(200, R)).toBe(1);
        expect(spinsForDepositAmount(500, R)).toBe(1);
        expect(spinsForDepositAmount(1000, R)).toBe(1);
        expect(spinsForDepositAmount(2000, R)).toBe(1);
        expect(spinsForDepositAmount(5000, R)).toBe(1);
        expect(spinsForDepositAmount(10000, R)).toBe(2);
        expect(spinsForDepositAmount(30000, R)).toBe(3);
        expect(spinsForDepositAmount(50000, R)).toBe(5);
        expect(spinsForDepositAmount(100000, R)).toBe(5);
    });

    test("between tiers uses the highest qualifying", () => {
        expect(spinsForDepositAmount(7000, R)).toBe(1);
        expect(spinsForDepositAmount(15000, R)).toBe(2);
        expect(spinsForDepositAmount(99999, R)).toBe(5);
    });

    test("does not stack lower tiers", () => {
        expect(spinsForDepositAmount(100000, R)).toBe(5);
        expect(spinsForDepositAmount(100000, R)).not.toBe(20);
    });

    test("audit stamp is idempotent", () => {
        const once = mergeLuckySpinsAwarded({ foo: 1 }, 2);
        expect(readLuckySpinsAwarded(once)).toBe(2);
        const twice = mergeLuckySpinsAwarded(once, 9);
        expect(readLuckySpinsAwarded(twice)).toBe(9);
        expect(twice.foo).toBe(1);
        expect(readLuckySpinsAwarded({})).toBeNull();
        expect(readLuckySpinsAwarded(null)).toBeNull();
    });
});
