import type {
    WingoBet,
    WingoResultColor,
    WingoResultSize,
} from "@bcwin/db";

interface PeriodResult {
    number: number;
    color: WingoResultColor;
    size: WingoResultSize;
}

export class GameLogic {
    private static readonly MULTIPLIERS = {
        COLOR_NORMAL: 2.0,
        COLOR_SPECIAL: 1.5,
        VIOLET: 4.5,
        NUMBER: 9.0,
        SIZE: 2.0,
    };

    static validateBetChoice(betType: string, betChoice: string): boolean {
        switch (betType) {
            case "COLOR":
                return ["RED", "GREEN", "VIOLET"].includes(betChoice);
            case "NUMBER":
                const num = parseInt(betChoice);
                return !isNaN(num) && num >= 0 && num <= 9;
            case "SIZE":
                return ["BIG", "SMALL"].includes(betChoice);
            default:
                return false;
        }
    }

    static checkBetWin(bet: WingoBet, result: PeriodResult): boolean {
        switch (bet.betType) {
            case "NUMBER":
                return parseInt(bet.betChoice) === result.number;

            case "COLOR":
                // VIOLET is special: only wins on digit 0 or 5 (not stored as primary color)
                if (bet.betChoice === "VIOLET") {
                    return result.number === 0 || result.number === 5;
                }

                // Primary color is always even=RED / odd=GREEN (result.color)
                // On 0 & 5, RED/GREEN still pay at special multiplier (see getWinMultiplier)
                if (result.number === 0 || result.number === 5) {
                    if (result.number === 0 && bet.betChoice === "RED")
                        return true;
                    if (result.number === 5 && bet.betChoice === "GREEN")
                        return true;
                    return false;
                }

                return bet.betChoice === result.color;

            case "SIZE":
                if (result.number < 5 && bet.betChoice === "SMALL") {
                    return true;
                }
                if (result.number >= 5 && bet.betChoice === "BIG") {
                    return true;
                }
                return false;

            default:
                return false;
        }
    }

    static getWinMultiplier(bet: WingoBet, result: PeriodResult): number {
        if (!this.checkBetWin(bet, result)) {
            return 0;
        }

        switch (bet.betType) {
            case "NUMBER":
                return this.MULTIPLIERS.NUMBER;

            case "COLOR":
                if (bet.betChoice === "VIOLET") {
                    return this.MULTIPLIERS.VIOLET;
                }

                if (
                    (result.number === 0 && bet.betChoice === "RED") ||
                    (result.number === 5 && bet.betChoice === "GREEN")
                ) {
                    return this.MULTIPLIERS.COLOR_SPECIAL;
                }

                return this.MULTIPLIERS.COLOR_NORMAL;

            case "SIZE":
                return this.MULTIPLIERS.SIZE;

            default:
                return 0;
        }
    }

    static calculateWinAmount(bet: WingoBet, result: PeriodResult): number {
        const multiplier = this.getWinMultiplier(bet, result);
        return multiplier > 0 ? bet.contractAmount * multiplier : 0;
    }

    static isSpecialCase(result: PeriodResult): boolean {
        return result.number === 0 || result.number === 5;
    }

    static getResultDescription(result: PeriodResult): string {
        let description = `${result.number} (${result.color}, ${result.size})`;

        if (result.number === 0) {
            description += " - also VIOLET";
        } else if (result.number === 5) {
            description += " - also VIOLET";
        }

        return description;
    }
}
