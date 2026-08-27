import { describe, expect, test } from "bun:test";
import { mapGameToRebateCategory } from "../../packages/rebate/gameCategory";

describe("Inout rebate category mapping (no DB)", () => {
    test("catalog strings pick CASINO / SLOTS / SPORTS / RUMMY", () => {
        expect(mapGameToRebateCategory("INOUT", "live casino")).toBe("CASINO");
        expect(mapGameToRebateCategory("INOUT", "slots")).toBe("SLOTS");
        expect(mapGameToRebateCategory("INOUT", "football")).toBe("SPORTS");
        expect(mapGameToRebateCategory("INOUT", "teen patti")).toBe("RUMMY");
        expect(mapGameToRebateCategory("WINGO", null)).toBe("LOTTERY");
        expect(mapGameToRebateCategory("INOUT", null)).toBe("SLOTS");
    });
});
