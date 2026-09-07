import { describe, expect, test } from "bun:test";
import { findFullNumberCoverage, isIllegalBetPair, type IllegalBetGame, type IllegalBetInput } from "../../packages/illegal-bets/rules";

function bet(betType: string, betChoice: string, extra: Partial<IllegalBetInput> = {}): IllegalBetInput {
    return { id: crypto.randomUUID(), userId: "user", periodId: "period", betAmount: 100, betType, betChoice, ...extra };
}
function pair(game: IllegalBetGame, a: IllegalBetInput, b: IllegalBetInput, expected: boolean) {
    expect(isIllegalBetPair(game, a, b)).toBe(expected);
    expect(isIllegalBetPair(game, b, a)).toBe(expected);
    if (a.betAmount > 0 && b.betAmount > 0 && Number.isFinite(a.betAmount) && Number.isFinite(b.betAmount)) {
        const differentStake = { ...b, betAmount: a.betAmount + 40 };
        expect(isIllegalBetPair(game, a, differentStake)).toBe(expected);
        expect(isIllegalBetPair(game, differentStake, a)).toBe(expected);
    }
}

describe("Illegal bet selection rules", () => {
    for (const game of ["WINGO", "TRXWINGO"] as const) {
        test(`${game}: every digit against colors and size, in either bet order`, () => {
            for (let n = 0; n <= 9; n++) {
                const number = bet("NUMBER", String(n));
                pair(game, number, bet("COLOR", "RED"), n % 2 === 1);
                pair(game, number, bet("COLOR", "GREEN"), n % 2 === 0);
                pair(game, number, bet("COLOR", "VIOLET"), n !== 0 && n !== 5);
                pair(game, number, bet("SIZE", "BIG"), n < 5);
                pair(game, number, bet("SIZE", "SMALL"), n >= 5);
            }
            pair(game, bet("COLOR", "RED"), bet("COLOR", "GREEN"), true);
            pair(game, bet("COLOR", "RED"), bet("COLOR", "VIOLET"), false);
            pair(game, bet("COLOR", "GREEN"), bet("SIZE", "BIG"), false);
            pair(game, bet("NUMBER", "2"), bet("NUMBER", "3"), false);
        });
    }
    test("same user, round and distinct valid bets are required", () => {
        const number = bet("NUMBER", "3");
        const red = bet("COLOR", "RED");
        for (const extra of [{ userId: "other" }, { periodId: "other" }, { id: number.id }]) {
            pair("WINGO", number, { ...red, ...extra }, false);
        }
        pair("WINGO", { ...number, betAmount: 0 }, { ...red, betAmount: 0 }, false);
        pair("WINGO", bet("NUMBER", "invalid"), red, false);
        pair("WINGO", bet("NUMBER", "13"), red, false);
        pair("WINGO", bet("NUMBER", "03"), red, true);
        for (const amount of [0, -1, NaN, Infinity]) {
            pair("WINGO", number, { ...red, betAmount: amount }, false);
        }
    });
    test("100 on BIG and 40 on number 3 is illegal; number 7 stays allowed", () => {
        const big = bet("SIZE", "BIG", { betAmount: 100 });
        pair("WINGO", big, bet("NUMBER", "3", { betAmount: 40 }), true);
        pair("WINGO", big, bet("NUMBER", "7", { betAmount: 40 }), false);
    });
    test("K3 exact sum uses 3-10 SMALL, 11-18 BIG and sum parity", () => {
        for (let n = 3; n <= 18; n++) {
            const sum = bet("SUM", String(n));
            pair("K3", sum, bet("BIG", "BIG"), n < 11);
            pair("K3", sum, bet("SMALL", "SMALL"), n >= 11);
            pair("K3", sum, bet("ODD", "ODD"), n % 2 === 0);
            pair("K3", sum, bet("EVEN", "EVEN"), n % 2 === 1);
        }
        // A specific triple choice is a die face, not a SUM bet.
        pair("K3", bet("TRIPLE_SPECIFIC", "3"), bet("BIG", "BIG"), false);
        pair("K3", bet("TWO_NUMBERS", "2,5"), bet("EVEN", "EVEN"), false);
    });
    test("Moto comparisons stay on the same finishing position and accept lowercase choices", () => {
        for (let n = 1; n <= 10; n++) {
            const number = bet("POSITION", String(n), { targetPosition: "FIRST" });
            for (const [choice, illegal] of [["big", n < 6], ["small", n >= 6], ["odd", n % 2 === 0], ["even", n % 2 === 1]] as const) {
                const other = bet(choice === "big" || choice === "small" ? "BIG_SMALL" : "ODD_EVEN", choice, { targetPosition: "FIRST" });
                pair("MOTO", number, other, illegal);
                pair("MOTO", number, { ...other, targetPosition: "SECOND" }, false);
            }
        }
        pair("MOTO", bet("BIG_SMALL", "big", { targetPosition: "THIRD" }), bet("BIG_SMALL", "small", { targetPosition: "THIRD" }), true);
    });
    test("5D digit and sum scopes have separate boundaries", () => {
        for (const scope of [{ betCategory: "POSITION", position: "A", max: 9, high: 5, exact: "EXACT_NUMBER" }, { betCategory: "SUM", position: null, max: 45, high: 23, exact: "SUM_EXACT" }]) {
            for (let n = 0; n <= scope.max; n++) {
                const number = bet(scope.exact, String(n), scope);
                pair("5D", number, bet("HIGH", "HIGH", scope), n < scope.high);
                pair("5D", number, bet("LOW", "LOW", scope), n >= scope.high);
                pair("5D", number, bet("ODD", "ODD", scope), n % 2 === 0);
                pair("5D", number, bet("EVEN", "EVEN", scope), n % 2 === 1);
            }
        }
        const a = bet("LOW", "LOW", { betCategory: "POSITION", position: "A" });
        pair("5D", a, bet("HIGH", "HIGH", { betCategory: "POSITION", position: "B" }), false);
        pair("5D", a, bet("HIGH", "HIGH", { betCategory: "SUM" }), false);
        pair("5D", a, bet("HIGH", "HIGH", { betCategory: "POSITION", position: "A" }), true);
    });
    test("full numeric coverage requires all values at the same stake and scope", () => {
        const bets = Array.from({ length: 10 }, (_, n) => bet("NUMBER", String(n)));
        expect(findFullNumberCoverage("WINGO", bets)).toHaveLength(1);
        expect(findFullNumberCoverage("WINGO", bets.slice(1))).toHaveLength(0);
        expect(findFullNumberCoverage("WINGO", [...bets.slice(1), { ...bets[0], betAmount: 50 }])).toHaveLength(0);
        const digits = bets.map((b) => ({ ...b, betType: "EXACT_NUMBER", betCategory: "POSITION", position: "A" }));
        expect(findFullNumberCoverage("5D", digits)).toHaveLength(1);
        expect(findFullNumberCoverage("5D", digits.map((b, i) => ({ ...b, position: i % 2 ? "A" : "B" })))).toHaveLength(0);
    });
});
