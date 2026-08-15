import type { K3Bet } from "@bcwin/db";

interface PeriodResult {
    dice1: number;
    dice2: number;
    dice3: number;
    sum: number;
    isTriple: boolean;
    isDouble: boolean;
    isAllDifferent: boolean;
    isConsecutive: boolean;
    isBig: boolean;
    isSmall: boolean;
    isOdd: boolean;
    isEven: boolean;
}

const K3_MULTIPLIERS = {
    // Sum multipliers based on probability (higher odds for rarer sums)
    SUM: {
        3: 50, 4: 30, 5: 18, 6: 12, 7: 8, 8: 6,
        9: 6, 10: 6, 11: 6, 12: 6, 13: 8, 14: 12,
        15: 18, 16: 30, 17: 50, 18: 50
    } as Record<number, number>,
    
    TRIPLE_SPECIFIC: 150,     // Specific triple (e.g., 333)
    TRIPLE_ANY: 24,           // Any triple
    DOUBLE_SPECIFIC: 8,       // Specific double combo
    DOUBLE_ANY: 3,            // Any double (not triple)
    ALL_DIFFERENT: 6,         // All dice different
    TWO_NUMBERS: 5,           // Both numbers appear
    CONSECUTIVE: 50,          // Consecutive sequence
    BIG: 1.95,               // Sum 11-18 (excluding triples)
    SMALL: 1.95,             // Sum 3-10 (excluding triples)
    ODD: 1.95,               // Odd sum
    EVEN: 1.95               // Even sum
};

export class GameLogic {
    static validateBetChoice(betType: string, betChoice: string): boolean {
        switch (betType) {
            case "SUM":
                const sum = parseInt(betChoice);
                return !isNaN(sum) && sum >= 3 && sum <= 18;
            
            case "TRIPLE_SPECIFIC":
                const tripleNum = parseInt(betChoice);
                return !isNaN(tripleNum) && tripleNum >= 1 && tripleNum <= 6;
            
            case "TRIPLE_ANY":
            case "DOUBLE_ANY":
            case "ALL_DIFFERENT":
            case "CONSECUTIVE":
            case "BIG":
            case "SMALL":
            case "ODD":
            case "EVEN":
                return betChoice === betType;
            
            case "DOUBLE_SPECIFIC":
                return this.validateDoubleSpecific(betChoice);
            
            case "TWO_NUMBERS":
                return this.validateTwoNumbers(betChoice);
            
            default:
                return false;
        }
    }

    private static validateDoubleSpecific(betChoice: string): boolean {
        // Format: "4,4,6" or "4-4-6"
        const parts = betChoice.split(/[,-]/).map(n => parseInt(n.trim()));
        if (parts.length !== 3) return false;
        if (parts.some(n => isNaN(n) || n < 1 || n > 6)) return false;
        
        const counts = parts.reduce((acc, n) => {
            acc[n] = (acc[n] || 0) + 1;
            return acc;
        }, {} as Record<number, number>);
        
        const values = Object.values(counts);
        return values.includes(2) && values.includes(1);
    }

    private static validateTwoNumbers(betChoice: string): boolean {
        // Format: "2,5" or "2-5"
        const parts = betChoice.split(/[,-]/).map(n => parseInt(n.trim()));
        return parts.length === 2 && 
               parts.every(n => !isNaN(n) && n >= 1 && n <= 6) && 
               parts[0] !== parts[1];
    }

    static checkBetWin(bet: K3Bet, result: PeriodResult): boolean {
        switch (bet.betType) {
            case "SUM":
                return parseInt(bet.betChoice) === result.sum;
            
            case "TRIPLE_ANY":
                return result.isTriple;
            
            case "TRIPLE_SPECIFIC":
                const targetTriple = parseInt(bet.betChoice);
                return result.isTriple && 
                       result.dice1 === targetTriple && 
                       result.dice2 === targetTriple && 
                       result.dice3 === targetTriple;
            
            case "DOUBLE_ANY":
                return result.isDouble;
            
            case "DOUBLE_SPECIFIC":
                return this.checkDoubleSpecificWin(bet.betChoice, result);
            
            case "ALL_DIFFERENT":
                return result.isAllDifferent;
            
            case "TWO_NUMBERS":
                return this.checkTwoNumbersWin(bet.betChoice, result);
            
            case "CONSECUTIVE":
                return result.isConsecutive;
            
            case "BIG":
                return result.isBig;
            
            case "SMALL":
                return result.isSmall;
            
            case "ODD":
                return result.isOdd;
            
            case "EVEN":
                return result.isEven;
            
            default:
                return false;
        }
    }

    private static checkDoubleSpecificWin(betChoice: string, result: PeriodResult): boolean {
        const betParts = betChoice.split(/[,-]/).map(n => parseInt(n.trim())).sort();
        const resultParts = [result.dice1, result.dice2, result.dice3].sort();
        
        return betParts.length === 3 && 
               resultParts.length === 3 &&
               betParts[0] === resultParts[0] &&
               betParts[1] === resultParts[1] &&
               betParts[2] === resultParts[2];
    }

    private static checkTwoNumbersWin(betChoice: string, result: PeriodResult): boolean {
        const betNumbers = betChoice.split(/[,-]/).map(n => parseInt(n.trim()));
        const resultNumbers = [result.dice1, result.dice2, result.dice3];
        
        return betNumbers.length === 2 &&
               betNumbers.every(num => resultNumbers.includes(num));
    }

    static getWinMultiplier(bet: K3Bet, result: PeriodResult): number {
        switch (bet.betType) {
            case "SUM":
                const sum = parseInt(bet.betChoice);
                return K3_MULTIPLIERS.SUM[sum] || 6;
            
            case "TRIPLE_SPECIFIC":
                return K3_MULTIPLIERS.TRIPLE_SPECIFIC;
            
            case "TRIPLE_ANY":
                return K3_MULTIPLIERS.TRIPLE_ANY;
            
            case "DOUBLE_SPECIFIC":
                return K3_MULTIPLIERS.DOUBLE_SPECIFIC;
            
            case "DOUBLE_ANY":
                return K3_MULTIPLIERS.DOUBLE_ANY;
            
            case "ALL_DIFFERENT":
                return K3_MULTIPLIERS.ALL_DIFFERENT;
            
            case "TWO_NUMBERS":
                return K3_MULTIPLIERS.TWO_NUMBERS;
            
            case "CONSECUTIVE":
                return K3_MULTIPLIERS.CONSECUTIVE;
            
            case "BIG":
                return K3_MULTIPLIERS.BIG;
            
            case "SMALL":
                return K3_MULTIPLIERS.SMALL;
            
            case "ODD":
                return K3_MULTIPLIERS.ODD;
            
            case "EVEN":
                return K3_MULTIPLIERS.EVEN;
            
            default:
                return 0;
        }
    }

    static calculateWinAmount(bet: K3Bet, result: PeriodResult): number {
        const multiplier = this.getWinMultiplier(bet, result);
        return bet.contractAmount * multiplier;
    }

    static getResultDescription(result: PeriodResult): string {
        const diceStr = `[${result.dice1},${result.dice2},${result.dice3}]`;
        const properties = [];
        
        if (result.isTriple) properties.push("TRIPLE");
        if (result.isDouble) properties.push("DOUBLE");
        if (result.isAllDifferent) properties.push("ALL_DIFFERENT");
        if (result.isConsecutive) properties.push("CONSECUTIVE");
        if (result.isBig) properties.push("BIG");
        if (result.isSmall) properties.push("SMALL");
        if (result.isOdd) properties.push("ODD");
        if (result.isEven) properties.push("EVEN");
        
        return `${diceStr} Sum:${result.sum} ${properties.join(",")}`;
    }
}