import type { RebateGameCategory } from "@bcwin/db";

/**
 * Map bet game code (+ optional Inout catalog category) → rebate rate category.
 */
export function mapGameToRebateCategory(
    game: string,
    inoutCategory?: string | null
): RebateGameCategory {
    const g = String(game ?? "").toUpperCase().replace(/[-\s]/g, "");
    const cat = String(inoutCategory ?? "").toLowerCase();

    if (
        g === "WINGO" ||
        g === "TRXWINGO" ||
        g === "K3" ||
        g === "5D" ||
        g === "FIVED" ||
        g === "MOTO" ||
        g === "MOTORACING"
    ) {
        return "LOTTERY";
    }

    if (g === "INOUT" || g.includes("INOUT") || cat) {
        if (
            cat.includes("sport") ||
            cat.includes("cricket") ||
            cat.includes("football")
        ) {
            return "SPORTS";
        }
        if (
            cat.includes("rummy") ||
            cat.includes("poker") ||
            cat.includes("teen") ||
            cat.includes("card") ||
            cat.includes("chess")
        ) {
            return "RUMMY";
        }
        if (
            cat.includes("mini") ||
            cat.includes("lottery") ||
            cat.includes("crash") ||
            cat.includes("instant")
        ) {
            // mini / crash / lottery-like third-party → lottery rates
            return "LOTTERY";
        }
        // Slots is its own rebate header (screenshot: "Slots commission")
        if (cat.includes("slot")) {
            return "SLOTS";
        }
        // casino, live, fishing, table → Casino commission
        if (
            cat.includes("casino") ||
            cat.includes("live") ||
            cat.includes("fish") ||
            cat.includes("table")
        ) {
            return "CASINO";
        }
        // Inout default without clear category → slots (most volume)
        return "SLOTS";
    }

    return "LOTTERY";
}
