import { ResultSetter } from "@bcwin/cache";
import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { WebSocketManager } from "@bcwin/websocket";
import type { WingoResultColor, WingoResultSize } from "@bcwin/db";
import { SystemSettings } from "@bcwin/config";
import { GameLogic } from "./gameLogic";
import { getLatestBlock } from "../trxwingo/tron";

const logger = new Logger("result-generator");

interface PeriodResult {
    number: number;
    color: WingoResultColor;
    size: WingoResultSize;
}

export class ResultGenerator {
    generateResultNumber(): number {
        return Math.floor(Math.random() * 10);
    }

    /**
     * Primary color from parity (all digits):
     * even (0,2,4,6,8) → RED · odd (1,3,5,7,9) → GREEN
     * Digits 0 & 5 also pay VIOLET as a special color bet (see GameLogic).
     */
    calculateResultColor(number: number): WingoResultColor {
        return number % 2 === 0 ? "RED" : "GREEN";
    }

    calculateResultSize(number: number): WingoResultSize {
        return number >= 5 ? "BIG" : "SMALL";
    }

    private async calculateWinningNumber(periodId: string): Promise<number> {
        try {
            // 1. Get all pending bets for this period
            const bets = await prisma.wingoBet.findMany({
                where: {
                    periodId: periodId,
                    status: "PENDING",
                },
            });

            if (bets.length === 0) {
                return this.generateResultNumber();
            }

            // 2. Calculate total payout for each possible number (0-9)
            const payoutByNumber: { number: number; payout: number }[] = [];

            for (let i = 0; i <= 9; i++) {
                const result: PeriodResult = {
                    number: i,
                    color: this.calculateResultColor(i),
                    size: this.calculateResultSize(i),
                };

                let totalPayout = 0;

                for (const bet of bets) {
                    if (GameLogic.checkBetWin(bet, result)) {
                        totalPayout += GameLogic.calculateWinAmount(
                            bet,
                            result
                        );
                    }
                }

                payoutByNumber.push({ number: i, payout: totalPayout });
            }

            logger.debug("Payout by number", { payoutByNumber });

            // 3. Find the number(s) with the minimum payout
            payoutByNumber.sort((a, b) => a.payout - b.payout);

            const minPayout = payoutByNumber[0].payout;
            const winningNumbers = payoutByNumber
                .filter((item) => item.payout === minPayout)
                .map((item) => item.number);

            logger.debug("Winning numbers", { winningNumbers });

            // 4. If there are multiple, pick one randomly
            const randomIndex = Math.floor(
                Math.random() * winningNumbers.length
            );
            return winningNumbers[randomIndex];
        } catch (error) {
            logger.error(
                `Error calculating winning number for period ${periodId}:`,
                error
            );
            // Fallback to random in case of error
            return this.generateResultNumber();
        }
    }

    async generateCompleteResult(periodId: string): Promise<PeriodResult> {
        const adminResult = await ResultSetter.get("wingo", periodId);

        let number: number | null = null;
        if (adminResult) {
            number = adminResult.number;
            logger.debug("Admin has manually set the result", {
                periodId,
                number,
            });
            await ResultSetter.del("wingo", periodId);
        } else {
            const algorithm = await SystemSettings.getWingoAlgorithm();
            if (algorithm === "WINNING") {
                number = await this.calculateWinningNumber(periodId);
                logger.debug("Generated result using WINNING algorithm", {
                    periodId,
                    number,
                });
            } else if (algorithm === "TRX") {
                try {
                    const block = await getLatestBlock();
                    const match = block.hash.match(/\d(?=[^\d]*$)/);
                    number = match ? parseInt(match[0]) : block.number % 10;
                    logger.debug("Generated result using TRX block hash algorithm", {
                        periodId,
                        number,
                        blockHash: block.hash,
                        blockNumber: block.number,
                    });
                } catch (error) {
                    logger.error("Error generating TRX result, falling back to random", error);
                    number = this.generateResultNumber();
                }
            } else {
                number = this.generateResultNumber();
            }
        }

        const color = this.calculateResultColor(number);
        const size = this.calculateResultSize(number);

        return { number, color, size };
    }

    async processPeriodResult(periodId: string): Promise<PeriodResult | null> {
        try {
            const period = await prisma.wingoPeriod.findUnique({
                where: { id: periodId },
            });

            if (!period) {
                logger.error(`Period not found: ${periodId}`);
                return null;
            }

            if (period.status !== "ENDED") {
                logger.error(`Period ${periodId} is not in ENDED status`);
                return null;
            }

            const result = await this.generateCompleteResult(periodId);

            await prisma.wingoPeriod.update({
                where: { id: periodId },
                data: {
                    resultNumber: result.number,
                    resultColor: result.color,
                    resultSize: result.size,
                },
            });

            WebSocketManager.publishToTopic("wingo-results", {
                periodId,
                periodNumber: period.periodNumber,
                durationSeconds: period.durationSeconds,
                startTime: period.startTime,
                endTime: period.endTime,
                number: result.number,
                color: result.color,
                size: result.size,
            });

            logger.debug("Generated result", {
                periodId,
                periodNumber: period.periodNumber,
                durationSeconds: period.durationSeconds,
                number: result.number,
                color: result.color,
                size: result.size,
            });

            return result;
        } catch (error) {
            logger.error(
                `Error processing result for period ${periodId}:`,
                error
            );
            return null;
        }
    }

    async processAllEndedPeriods(): Promise<void> {
        try {
            const endedPeriods = await prisma.wingoPeriod.findMany({
                where: {
                    status: "ENDED",
                    resultNumber: null,
                },
                orderBy: { endTime: "asc" },
            });

            for (const period of endedPeriods) {
                await this.processPeriodResult(period.id);
            }
        } catch (error) {
            logger.error("Error processing ended periods:", error);
        }
    }

    isSpecialResult(number: number): boolean {
        return number === 0 || number === 5;
    }

    /** Extra color paid on special digits (alongside parity RED/GREEN). */
    getSecondaryColor(number: number): WingoResultColor | null {
        if (number === 0 || number === 5) return "VIOLET";
        return null;
    }
}
