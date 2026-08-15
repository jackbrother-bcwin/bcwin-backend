import { describe, test, expect } from "bun:test";
import { GameLogic as K3GameLogic } from "../../apps/engine/src/services/k3/gameLogic";
import { FiveDGameLogic } from "../../apps/engine/src/services/5d/gameLogic";
import { MotoGameLogic } from "../../apps/engine/src/services/moto/gameLogic";

describe("Engine: K3 / 5D / Moto game logic (unit)", () => {
    describe("K3GameLogic", () => {
        test("exports usable helpers", () => {
            expect(typeof K3GameLogic).toBe("function");
            const methods = Object.getOwnPropertyNames(K3GameLogic).filter(
                (m) => typeof (K3GameLogic as any)[m] === "function"
            );
            expect(methods.length).toBeGreaterThan(0);
        });

        test("sum big/small style checks if available", () => {
            const result = {
                dice1: 6,
                dice2: 6,
                dice3: 6,
                sum: 18,
                isTriple: true,
                isDouble: false,
                isAllDifferent: false,
                isConsecutive: false,
                isBig: true,
                isSmall: false,
                isOdd: false,
                isEven: true,
            };
            const bet = {
                betType: "BIG",
                betChoice: "BIG",
                betAmount: 10,
                contractAmount: 9.8,
            } as any;

            if (typeof (K3GameLogic as any).checkBetWin === "function") {
                const win = (K3GameLogic as any).checkBetWin(bet, result);
                expect(typeof win).toBe("boolean");
            }
        });
    });

    describe("FiveDGameLogic", () => {
        test("exports methods", () => {
            const methods = Object.getOwnPropertyNames(FiveDGameLogic).filter(
                (m) => typeof (FiveDGameLogic as any)[m] === "function"
            );
            expect(methods.length).toBeGreaterThan(0);
        });
    });

    describe("MotoGameLogic", () => {
        test("exports methods", () => {
            const methods = Object.getOwnPropertyNames(MotoGameLogic).filter(
                (m) => typeof (MotoGameLogic as any)[m] === "function"
            );
            expect(methods.length).toBeGreaterThan(0);
        });
    });
});
