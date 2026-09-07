export type IllegalBetGame = "WINGO" | "TRXWINGO" | "5D" | "K3" | "MOTO";

export type IllegalBetInput = {
    id: string;
    userId: string;
    periodId: string;
    betAmount: number;
    betType: string;
    betChoice: string;
    betCategory?: string;
    position?: string | null;
    targetPosition?: string;
};

type Selection = {
    scope: string;
    highFrom: number;
    min: number;
    max: number;
    number?: number;
    group?: string;
};

const opposites: Record<string, string> = {
    RED: "GREEN", GREEN: "RED", BIG: "SMALL", SMALL: "BIG",
    ODD: "EVEN", EVEN: "ODD", LOW: "HIGH", HIGH: "LOW",
};

function selection(game: IllegalBetGame, bet: IllegalBetInput): Selection | null {
    const choice = bet.betChoice.toUpperCase();
    let scope = "RESULT";
    let min = 0;
    let max = 9;
    let highFrom = 5;
    let exactType: string;
    let groups: string[];
    switch (game) {
        case "WINGO":
        case "TRXWINGO":
            exactType = "NUMBER";
            groups = bet.betType === "COLOR" ? ["RED", "GREEN", "VIOLET"]
                : bet.betType === "SIZE" ? ["BIG", "SMALL"] : [];
            break;
        case "K3":
            min = 3;
            max = 18;
            highFrom = 11;
            exactType = "SUM";
            groups = ["BIG", "SMALL", "ODD", "EVEN"].includes(bet.betType) ? [bet.betType] : [];
            break;
        case "MOTO":
            if (!["FIRST", "SECOND", "THIRD"].includes(bet.targetPosition ?? "")) return null;
            scope = bet.targetPosition!;
            min = 1;
            max = 10;
            highFrom = 6;
            exactType = "POSITION";
            groups = bet.betType === "BIG_SMALL" ? ["BIG", "SMALL"]
                : bet.betType === "ODD_EVEN" ? ["ODD", "EVEN"] : [];
            break;
        case "5D":
            if (bet.betCategory === "SUM") {
                scope = "SUM";
                max = 45;
                highFrom = 23;
                exactType = "SUM_EXACT";
            } else if (bet.betCategory === "POSITION" && ["A", "B", "C", "D", "E"].includes(bet.position ?? "")) {
                scope = bet.position!;
                exactType = "EXACT_NUMBER";
            } else {
                return null;
            }
            groups = ["LOW", "HIGH", "ODD", "EVEN"].includes(bet.betType) ? [bet.betType] : [];
            break;
    }
    if (bet.betType === exactType) {
        // Match the existing game validators and payout parsers.
        const number = Number.parseInt(bet.betChoice);
        return Number.isInteger(number) && number >= min && number <= max
            ? { scope, highFrom, min, max, number } : null;
    }
    return groups.includes(choice) ? { scope, highFrom, min, max, group: choice } : null;
}

function coversNumber(group: string, number: number, highFrom: number): boolean {
    switch (group) {
        case "RED":
        case "EVEN": return number % 2 === 0;
        case "GREEN":
        case "ODD": return number % 2 === 1;
        case "VIOLET": return number === 0 || number === 5;
        case "BIG":
        case "HIGH": return number >= highFrom;
        case "SMALL":
        case "LOW": return number < highFrom;
        default: return false;
    }
}

/** Equal-stake opposing selections, not a calculation of guaranteed profit. */
export function isIllegalBetPair(game: IllegalBetGame, a: IllegalBetInput, b: IllegalBetInput): boolean {
    if (a.id === b.id || a.userId !== b.userId || a.periodId !== b.periodId ||
        !Number.isFinite(a.betAmount) || a.betAmount <= 0 || a.betAmount !== b.betAmount) return false;
    const left = selection(game, a);
    const right = selection(game, b);
    if (!left || !right || left.scope !== right.scope) return false;
    if (left.group && right.group) return opposites[left.group] === right.group;
    if (left.number !== undefined && right.group) {
        return !coversNumber(right.group, left.number, right.highFrom);
    }
    if (right.number !== undefined && left.group) {
        return !coversNumber(left.group, right.number, left.highFrom);
    }
    return false;
}

/** Also catch equal-stake bets on every exact number in a single market. */
export function findFullNumberCoverage(game: IllegalBetGame, bets: IllegalBetInput[]) {
    const groups = new Map<string, { scope: string; min: number; max: number; numbers: Map<number, IllegalBetInput> }>();
    for (const bet of bets) {
        if (!Number.isFinite(bet.betAmount) || bet.betAmount <= 0) continue;
        const pick = selection(game, bet);
        if (!pick || pick.number === undefined) continue;
        const key = JSON.stringify([bet.userId, bet.periodId, pick.scope, bet.betAmount]);
        const group = groups.get(key) ?? { scope: pick.scope, min: pick.min, max: pick.max, numbers: new Map() };
        const existing = group.numbers.get(pick.number);
        if (!existing || bet.id < existing.id) group.numbers.set(pick.number, bet);
        groups.set(key, group);
    }
    return [...groups.values()]
        .filter((group) => group.numbers.size === group.max - group.min + 1)
        .map((group) => ({ scope: group.scope, bets: [...group.numbers.values()] }));
}
