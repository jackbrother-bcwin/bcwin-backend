import { ResultSetter } from "@bcwin/cache";
import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { WebSocketManager } from "@bcwin/websocket";
import type { FiveDPeriod } from "@bcwin/db";

const logger = new Logger("5d-result-generator");

export class FiveDResultGenerator {
    /**
     * Generate a random 5-digit number (00000-99999)
     */
    async generateResult5D(periodId: string) {
        const adminResult = await ResultSetter.get("5d", periodId);

        if (adminResult) {
            const number = adminResult.resultNumber;

            logger.debug("Admin has manually set the result", {
                periodId,
                number,
            });

            await ResultSetter.del("5d", periodId);

            return number;
        }

        const randomNumber = Math.floor(Math.random() * 100000);
        return randomNumber.toString().padStart(5, "0");
    }

    /**
     * Parse a 5-digit number string into individual digits and calculate sum
     */
    parseDigits(resultNumber: string): {
        digitA: number;
        digitB: number;
        digitC: number;
        digitD: number;
        digitE: number;
        sum: number;
    } {
        if (resultNumber.length !== 5) {
            throw new Error("Result number must be exactly 5 digits");
        }

        const digitA = parseInt(resultNumber[0]);
        const digitB = parseInt(resultNumber[1]);
        const digitC = parseInt(resultNumber[2]);
        const digitD = parseInt(resultNumber[3]);
        const digitE = parseInt(resultNumber[4]);
        const sum = digitA + digitB + digitC + digitD + digitE;

        // Validate each digit is 0-9
        const digits = [digitA, digitB, digitC, digitD, digitE];
        for (const digit of digits) {
            if (isNaN(digit) || digit < 0 || digit > 9) {
                throw new Error(
                    `Invalid digit: ${digit}. Each digit must be 0-9`
                );
            }
        }

        // Validate sum is within expected range (0-45)
        if (sum < 0 || sum > 45) {
            throw new Error(`Invalid sum: ${sum}. Sum must be 0-45`);
        }

        return {
            digitA,
            digitB,
            digitC,
            digitD,
            digitE,
            sum,
        };
    }

    /**
     * Process result for a specific period
     */
    async processePeriodResult(periodId: string): Promise<void> {
        try {
            const period = await prisma.fiveDPeriod.findUnique({
                where: { id: periodId },
            });

            if (!period) {
                logger.error(`5D Period not found: ${periodId}`);
                return;
            }

            if (period.status !== "ENDED") {
                logger.warn(
                    `5D Period ${periodId} is not in ENDED status, current: ${period.status}`
                );
                return;
            }

            if (period.resultNumber) {
                logger.warn(
                    `5D Period ${periodId} already has a result: ${period.resultNumber}`
                );
                return;
            }

            // Generate result
            const resultNumber = await this.generateResult5D(periodId);
            const { digitA, digitB, digitC, digitD, digitE, sum } =
                this.parseDigits(resultNumber);

            // Update period with result
            const updatedPeriod = await prisma.fiveDPeriod.update({
                where: { id: periodId },
                data: {
                    resultNumber,
                    resultDigitA: digitA,
                    resultDigitB: digitB,
                    resultDigitC: digitC,
                    resultDigitD: digitD,
                    resultDigitE: digitE,
                    resultSum: sum,
                },
            });

            // Publish result via WebSocket
            WebSocketManager.publishToTopic("5d-results", {
                periodId: updatedPeriod.id,
                periodNumber: updatedPeriod.periodNumber,
                durationSeconds: period.durationSeconds,
                startTime: period.startTime,
                endTime: period.endTime,
                resultNumber,
                resultDigitA: digitA,
                resultDigitB: digitB,
                resultDigitC: digitC,
                resultDigitD: digitD,
                resultDigitE: digitE,
                resultSum: sum,
            });

            logger.info("Generated 5D result", {
                periodId,
                periodNumber: period.periodNumber,
                resultNumber,
                digits: { digitA, digitB, digitC, digitD, digitE },
                sum,
            });
        } catch (error) {
            logger.error(
                `Error processing 5D result for period ${periodId}:`,
                error
            );
            throw error;
        }
    }

    /**
     * Process results for all ended periods that don't have results yet
     */
    async processAllEndedPeriods(): Promise<void> {
        try {
            const endedPeriods = await prisma.fiveDPeriod.findMany({
                where: {
                    status: "ENDED",
                    resultNumber: null,
                },
                orderBy: { endTime: "asc" },
            });

            logger.debug(
                `Found ${endedPeriods.length} 5D periods needing results`
            );

            for (const period of endedPeriods) {
                try {
                    await this.processePeriodResult(period.id);
                } catch (error) {
                    logger.error(
                        `Failed to process result for 5D period ${period.id}:`,
                        error
                    );
                    // Continue processing other periods even if one fails
                }
            }
        } catch (error) {
            logger.error("Error processing all ended 5D periods:", error);
        }
    }

    /**
     * Validate a result number format and digits
     */
    // validateResultNumber(resultNumber: string): boolean {
    //     try {
    //         this.parseDigits(resultNumber);
    //         return true;
    //     } catch (error) {
    //         return false;
    //     }
    // }

    /**
     * Get result statistics for a specific result number
     */
    // getResultStats(resultNumber: string): {
    //     resultNumber: string;
    //     digits: { A: number; B: number; C: number; D: number; E: number };
    //     sum: number;
    //     digitProperties: {
    //         A: {
    //             isLow: boolean;
    //             isHigh: boolean;
    //             isOdd: boolean;
    //             isEven: boolean;
    //         };
    //         B: {
    //             isLow: boolean;
    //             isHigh: boolean;
    //             isOdd: boolean;
    //             isEven: boolean;
    //         };
    //         C: {
    //             isLow: boolean;
    //             isHigh: boolean;
    //             isOdd: boolean;
    //             isEven: boolean;
    //         };
    //         D: {
    //             isLow: boolean;
    //             isHigh: boolean;
    //             isOdd: boolean;
    //             isEven: boolean;
    //         };
    //         E: {
    //             isLow: boolean;
    //             isHigh: boolean;
    //             isOdd: boolean;
    //             isEven: boolean;
    //         };
    //     };
    //     sumProperties: {
    //         isLow: boolean;
    //         isHigh: boolean;
    //         isOdd: boolean;
    //         isEven: boolean;
    //     };
    // } {
    //     const { digitA, digitB, digitC, digitD, digitE, sum } =
    //         this.parseDigits(resultNumber);

    //     const getDigitProperties = (digit: number) => ({
    //         isLow: digit >= 0 && digit <= 4,
    //         isHigh: digit >= 5 && digit <= 9,
    //         isOdd: digit % 2 === 1,
    //         isEven: digit % 2 === 0,
    //     });

    //     return {
    //         resultNumber,
    //         digits: {
    //             A: digitA,
    //             B: digitB,
    //             C: digitC,
    //             D: digitD,
    //             E: digitE,
    //         },
    //         sum,
    //         digitProperties: {
    //             A: getDigitProperties(digitA),
    //             B: getDigitProperties(digitB),
    //             C: getDigitProperties(digitC),
    //             D: getDigitProperties(digitD),
    //             E: getDigitProperties(digitE),
    //         },
    //         sumProperties: {
    //             isLow: sum >= 0 && sum <= 22,
    //             isHigh: sum >= 23 && sum <= 45,
    //             isOdd: sum % 2 === 1,
    //             isEven: sum % 2 === 0,
    //         },
    //     };
    // }

    /**
     * Generate multiple test results for development/testing
     */
    // generateTestResults(count: number = 10): string[] {
    //     const results: string[] = [];
    //     for (let i = 0; i < count; i++) {
    //         results.push(this.generateResult5D());
    //     }
    //     return results;
    // }

    /**
     * Get recent results with statistics
     */
    // async getRecentResultsWithStats(limit: number = 20): Promise<any[]> {
    //     const periods = await prisma.fiveDPeriod.findMany({
    //         where: {
    //             status: "RESOLVED",
    //             resultNumber: {
    //                 not: null,
    //             },
    //         },
    //         orderBy: { endTime: "desc" },
    //         take: limit,
    //         select: {
    //             id: true,
    //             periodNumber: true,
    //             durationSeconds: true,
    //             resultNumber: true,
    //             resultDigitA: true,
    //             resultDigitB: true,
    //             resultDigitC: true,
    //             resultDigitD: true,
    //             resultDigitE: true,
    //             resultSum: true,
    //             startTime: true,
    //             endTime: true,
    //         },
    //     });

    //     return periods.map((period) => ({
    //         ...period,
    //         stats: period.resultNumber
    //             ? this.getResultStats(period.resultNumber)
    //             : null,
    //     }));
    // }
}
