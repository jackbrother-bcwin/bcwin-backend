import type { MotoBet } from "@bcwin/db";

interface RaceResults {
    firstPlace: number;
    secondPlace: number;
    thirdPlace: number;
}

export class MotoGameLogic {
    private static readonly MULTIPLIERS = {
        POSITION: 9.8, // Exact bike number match
        ODD_EVEN: 2.0, // Odd/Even match
        BIG_SMALL: 2.0, // Big/Small match
    };

    static validateBetChoice(betType: string, betChoice: string): boolean {
        switch (betType) {
            case "POSITION":
                const bikeNum = parseInt(betChoice);
                return !isNaN(bikeNum) && bikeNum >= 1 && bikeNum <= 10;
            case "ODD_EVEN":
                return ["odd", "even"].includes(betChoice.toLowerCase());
            case "BIG_SMALL":
                return ["big", "small"].includes(betChoice.toLowerCase());
            default:
                return false;
        }
    }

    static validateTargetPosition(targetPosition: string): boolean {
        return ["FIRST", "SECOND", "THIRD"].includes(targetPosition);
    }

    static getBikeNumberAtPosition(
        results: RaceResults,
        position: string
    ): number {
        switch (position) {
            case "FIRST":
                return results.firstPlace;
            case "SECOND":
                return results.secondPlace;
            case "THIRD":
                return results.thirdPlace;
            default:
                throw new Error(`Invalid position: ${position}`);
        }
    }

    static isOdd(number: number): boolean {
        return number % 2 === 1;
    }

    static isBig(number: number): boolean {
        return number >= 6 && number <= 10;
    }

    static isSmall(number: number): boolean {
        return number >= 1 && number <= 5;
    }

    static checkBetWin(bet: MotoBet, results: RaceResults): boolean {
        const targetBikeNumber = this.getBikeNumberAtPosition(
            results,
            bet.targetPosition
        );

        switch (bet.betType) {
            case "POSITION":
                return parseInt(bet.betChoice) === targetBikeNumber;

            case "ODD_EVEN":
                const betChoice = bet.betChoice.toLowerCase();
                if (betChoice === "odd") {
                    return this.isOdd(targetBikeNumber);
                } else if (betChoice === "even") {
                    return !this.isOdd(targetBikeNumber);
                }
                return false;

            case "BIG_SMALL":
                const sizeChoice = bet.betChoice.toLowerCase();
                if (sizeChoice === "big") {
                    return this.isBig(targetBikeNumber);
                } else if (sizeChoice === "small") {
                    return this.isSmall(targetBikeNumber);
                }
                return false;

            default:
                return false;
        }
    }

    static getWinMultiplier(bet: MotoBet, results: RaceResults): number {
        if (!this.checkBetWin(bet, results)) {
            return 0;
        }

        switch (bet.betType) {
            case "POSITION":
                return this.MULTIPLIERS.POSITION;
            case "ODD_EVEN":
                return this.MULTIPLIERS.ODD_EVEN;
            case "BIG_SMALL":
                return this.MULTIPLIERS.BIG_SMALL;
            default:
                return 0;
        }
    }

    static calculateWinAmount(bet: MotoBet, results: RaceResults): number {
        const multiplier = this.getWinMultiplier(bet, results);
        return multiplier > 0 ? bet.contractAmount * multiplier : 0;
    }

    static getResultDescription(results: RaceResults): string {
        return `1st: ${results.firstPlace}, 2nd: ${results.secondPlace}, 3rd: ${results.thirdPlace}`;
    }

    static getBetDescription(bet: MotoBet): string {
        let description = `${bet.betChoice} on ${bet.targetPosition}`;

        switch (bet.betType) {
            case "POSITION":
                description = `Bike ${bet.betChoice} to finish ${bet.targetPosition}`;
                break;
            case "ODD_EVEN":
                description = `${bet.betChoice.toUpperCase()} number in ${
                    bet.targetPosition
                } place`;
                break;
            case "BIG_SMALL":
                description = `${bet.betChoice.toUpperCase()} number in ${
                    bet.targetPosition
                } place`;
                break;
        }

        return description;
    }
}
