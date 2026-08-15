import type { FiveDBet } from "@bcwin/db";

interface FiveDResult {
    resultNumber: string;
    digitA: number;
    digitB: number;
    digitC: number;
    digitD: number;
    digitE: number;
    sum: number;
}

export class FiveDGameLogic {
    private static readonly MULTIPLIERS = {
        POSITION_EXACT: 9.0, // Position exact number match
        POSITION_LOW_HIGH: 1.95, // Position low/high
        POSITION_ODD_EVEN: 1.95, // Position odd/even
        SUM_EXACT: 45.0, // Sum exact match
        SUM_LOW_HIGH: 1.95, // Sum low/high
        SUM_ODD_EVEN: 1.95, // Sum odd/even
    };

    /**
     * Validate bet choice for given bet type and category
     */
    static validateBetChoice(
        betCategory: string,
        betType: string,
        betChoice: string,
        position?: string
    ): boolean {
        // Position category validation
        if (betCategory === "POSITION") {
            if (!position) return false;

            switch (betType) {
                case "EXACT_NUMBER":
                    const num = parseInt(betChoice);
                    return !isNaN(num) && num >= 0 && num <= 9;
                case "LOW":
                    return betChoice === "LOW";
                case "HIGH":
                    return betChoice === "HIGH";
                case "ODD":
                    return betChoice === "ODD";
                case "EVEN":
                    return betChoice === "EVEN";
                default:
                    return false;
            }
        }

        // Sum category validation
        if (betCategory === "SUM") {
            if (position) return false; // Position should not be set for sum bets

            switch (betType) {
                case "SUM_EXACT":
                    const sumNum = parseInt(betChoice);
                    return !isNaN(sumNum) && sumNum >= 0 && sumNum <= 45;
                case "LOW":
                    return betChoice === "LOW";
                case "HIGH":
                    return betChoice === "HIGH";
                case "ODD":
                    return betChoice === "ODD";
                case "EVEN":
                    return betChoice === "EVEN";
                default:
                    return false;
            }
        }

        return false;
    }

    /**
     * Check if a bet wins based on the result
     */
    static checkBetWin(bet: FiveDBet, result: FiveDResult): boolean {
        if (bet.betCategory === "POSITION") {
            return this.checkPositionBetWin(bet, result);
        } else if (bet.betCategory === "SUM") {
            return this.checkSumBetWin(bet, result);
        }
        return false;
    }

    /**
     * Check if a position bet wins
     */
    static checkPositionBetWin(bet: FiveDBet, result: FiveDResult): boolean {
        if (!bet.position) return false;

        // Get the digit value for the specific position
        let digitValue: number;
        switch (bet.position) {
            case "A":
                digitValue = result.digitA;
                break;
            case "B":
                digitValue = result.digitB;
                break;
            case "C":
                digitValue = result.digitC;
                break;
            case "D":
                digitValue = result.digitD;
                break;
            case "E":
                digitValue = result.digitE;
                break;
            default:
                return false;
        }

        // Check bet type against digit value
        switch (bet.betType) {
            case "EXACT_NUMBER":
                return parseInt(bet.betChoice) === digitValue;
            case "LOW":
                return digitValue >= 0 && digitValue <= 4;
            case "HIGH":
                return digitValue >= 5 && digitValue <= 9;
            case "ODD":
                return digitValue % 2 === 1;
            case "EVEN":
                return digitValue % 2 === 0;
            default:
                return false;
        }
    }

    /**
     * Check if a sum bet wins
     */
    static checkSumBetWin(bet: FiveDBet, result: FiveDResult): boolean {
        const sumValue = result.sum;

        switch (bet.betType) {
            case "SUM_EXACT":
                return parseInt(bet.betChoice) === sumValue;
            case "LOW":
                return sumValue >= 0 && sumValue <= 22;
            case "HIGH":
                return sumValue >= 23 && sumValue <= 45;
            case "ODD":
                return sumValue % 2 === 1;
            case "EVEN":
                return sumValue % 2 === 0;
            default:
                return false;
        }
    }

    /**
     * Get the multiplier for a winning bet
     */
    static getWinMultiplier(bet: FiveDBet, result: FiveDResult): number {
        if (!this.checkBetWin(bet, result)) {
            return 0;
        }

        if (bet.betCategory === "POSITION") {
            switch (bet.betType) {
                case "EXACT_NUMBER":
                    return this.MULTIPLIERS.POSITION_EXACT;
                case "LOW":
                case "HIGH":
                    return this.MULTIPLIERS.POSITION_LOW_HIGH;
                case "ODD":
                case "EVEN":
                    return this.MULTIPLIERS.POSITION_ODD_EVEN;
                default:
                    return 0;
            }
        } else if (bet.betCategory === "SUM") {
            switch (bet.betType) {
                case "SUM_EXACT":
                    return this.MULTIPLIERS.SUM_EXACT;
                case "LOW":
                case "HIGH":
                    return this.MULTIPLIERS.SUM_LOW_HIGH;
                case "ODD":
                case "EVEN":
                    return this.MULTIPLIERS.SUM_ODD_EVEN;
                default:
                    return 0;
            }
        }

        return 0;
    }

    /**
     * Calculate the win amount for a bet
     */
    static calculateWinAmount(bet: FiveDBet, result: FiveDResult): number {
        const multiplier = this.getWinMultiplier(bet, result);
        return multiplier > 0 ? bet.contractAmount * multiplier : 0;
    }

    /**
     * Get a description of the result for logging/display
     */
    static getResultDescription(result: FiveDResult): string {
        const { resultNumber, digitA, digitB, digitC, digitD, digitE, sum } =
            result;
        return `${resultNumber} (A:${digitA}, B:${digitB}, C:${digitC}, D:${digitD}, E:${digitE}, Sum:${sum})`;
    }

    /**
     * Get bet description for logging/display
     */
    static getBetDescription(bet: FiveDBet): string {
        if (bet.betCategory === "POSITION") {
            return `${bet.position}-${bet.betType}:${bet.betChoice} (₹${bet.betAmount})`;
        } else {
            return `SUM-${bet.betType}:${bet.betChoice} (₹${bet.betAmount})`;
        }
    }

    /**
     * Validate that position and category combinations are correct
     */
    static validateBetStructure(
        betCategory: string,
        betType: string,
        position?: string
    ): boolean {
        if (betCategory === "POSITION") {
            // Position bets must have a position and valid position bet types
            return (
                !!position &&
                ["A", "B", "C", "D", "E"].includes(position) &&
                ["EXACT_NUMBER", "LOW", "HIGH", "ODD", "EVEN"].includes(betType)
            );
        } else if (betCategory === "SUM") {
            // Sum bets must not have a position and valid sum bet types
            return (
                !position &&
                ["SUM_EXACT", "LOW", "HIGH", "ODD", "EVEN"].includes(betType)
            );
        }
        return false;
    }

    /**
     * Get all possible bet choices for a given bet type and category
     */
    static getPossibleBetChoices(
        betCategory: string,
        betType: string
    ): string[] {
        if (betCategory === "POSITION") {
            switch (betType) {
                case "EXACT_NUMBER":
                    return ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
                case "LOW":
                    return ["LOW"];
                case "HIGH":
                    return ["HIGH"];
                case "ODD":
                    return ["ODD"];
                case "EVEN":
                    return ["EVEN"];
                default:
                    return [];
            }
        } else if (betCategory === "SUM") {
            switch (betType) {
                case "SUM_EXACT":
                    return Array.from({ length: 46 }, (_, i) => i.toString()); // 0-45
                case "LOW":
                    return ["LOW"];
                case "HIGH":
                    return ["HIGH"];
                case "ODD":
                    return ["ODD"];
                case "EVEN":
                    return ["EVEN"];
                default:
                    return [];
            }
        }
        return [];
    }

    /**
     * Calculate theoretical win probability for a bet type
     */
    static getWinProbability(betCategory: string, betType: string): number {
        if (betCategory === "POSITION") {
            switch (betType) {
                case "EXACT_NUMBER":
                    return 0.1; // 1 out of 10
                case "LOW":
                case "HIGH":
                    return 0.5; // 5 out of 10
                case "ODD":
                case "EVEN":
                    return 0.5; // 5 out of 10
                default:
                    return 0;
            }
        } else if (betCategory === "SUM") {
            switch (betType) {
                case "SUM_EXACT":
                    return 1 / 46; // 1 out of 46 possible sums
                case "LOW":
                case "HIGH":
                    // This is approximate - exact calculation would require combinatorics
                    return 0.5; // Roughly half the possible combinations
                case "ODD":
                case "EVEN":
                    return 0.5; // Half the possible sums are odd, half even
                default:
                    return 0;
            }
        }
        return 0;
    }

    /**
     * Get expected return rate for a bet (considering house edge)
     */
    // static getExpectedReturn(betCategory: string, betType: string): number {
    //     const probability = this.getWinProbability(betCategory, betType);
    //     let multiplier = 0;

    //     if (betCategory === "POSITION") {
    //         switch (betType) {
    //             case "EXACT_NUMBER":
    //                 multiplier = this.MULTIPLIERS.POSITION_EXACT;
    //                 break;
    //             case "LOW":
    //             case "HIGH":
    //                 multiplier = this.MULTIPLIERS.POSITION_LOW_HIGH;
    //                 break;
    //             case "ODD":
    //             case "EVEN":
    //                 multiplier = this.MULTIPLIERS.POSITION_ODD_EVEN;
    //                 break;
    //         }
    //     } else if (betCategory === "SUM") {
    //         switch (betType) {
    //             case "SUM_EXACT":
    //                 multiplier = this.MULTIPLIERS.SUM_EXACT;
    //                 break;
    //             case "LOW":
    //             case "HIGH":
    //                 multiplier = this.MULTIPLIERS.SUM_LOW_HIGH;
    //                 break;
    //             case "ODD":
    //             case "EVEN":
    //                 multiplier = this.MULTIPLIERS.SUM_ODD_EVEN;
    //                 break;
    //         }
    //     }

    //     // Expected return = probability * multiplier * contract_amount_ratio
    //     const contractRatio = (100 - Config.SERVICE_FEE_PERCENT) / 100;
    //     return probability * multiplier * contractRatio;
    // }
}
