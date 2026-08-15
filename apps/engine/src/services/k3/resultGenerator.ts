import { ResultSetter } from "@bcwin/cache";
import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { WebSocketManager } from "@bcwin/websocket";

const logger = new Logger("k3-result-generator");

interface DiceResult {
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

export class ResultGenerator {
    generateDiceRoll(): number {
        return Math.floor(Math.random() * 6) + 1;
    }

    private isConsecutiveSequence(d1: number, d2: number, d3: number): boolean {
        const sorted = [d1, d2, d3].sort((a, b) => a - b);

        // Check if it's one of the valid consecutive sequences: 123, 234, 345, 456
        const validSequences = [
            [1, 2, 3],
            [2, 3, 4],
            [3, 4, 5],
            [4, 5, 6],
        ];

        return validSequences.some(
            (sequence) =>
                sequence[0] === sorted[0] &&
                sequence[1] === sorted[1] &&
                sequence[2] === sorted[2]
        );
    }

    async generateCompleteResult(periodId: string): Promise<DiceResult> {
        const adminResult = await ResultSetter.get("k3", periodId);

        let dice1: number | null = null;
        let dice2: number | null = null;
        let dice3: number | null = null;

        if (adminResult) {
            dice1 = adminResult.dice1;
            dice2 = adminResult.dice2;
            dice3 = adminResult.dice3;

            logger.debug("Admin has manually set the result", {
                periodId,
                ...adminResult,
            });
            await ResultSetter.del("k3", periodId);
        } else {
            dice1 = this.generateDiceRoll();
            dice2 = this.generateDiceRoll();
            dice3 = this.generateDiceRoll();
        }

        const sum = dice1 + dice2 + dice3;

        // Check for triple (all three dice same)
        const isTriple = dice1 === dice2 && dice2 === dice3;

        // Check for double (at least two dice same, but not triple)
        const isDouble =
            !isTriple &&
            (dice1 === dice2 || dice1 === dice3 || dice2 === dice3);

        // Check for all different
        const isAllDifferent =
            dice1 !== dice2 && dice1 !== dice3 && dice2 !== dice3;

        // Check for consecutive sequence
        const isConsecutive = this.isConsecutiveSequence(dice1, dice2, dice3);

        // Check for big/small (but not if triple)
        const isBig = !isTriple && sum >= 11;
        const isSmall = !isTriple && sum <= 10;

        // Check for odd/even sum
        const isOdd = sum % 2 === 1;
        const isEven = sum % 2 === 0;

        return {
            dice1,
            dice2,
            dice3,
            sum,
            isTriple,
            isDouble,
            isAllDifferent,
            isConsecutive,
            isBig,
            isSmall,
            isOdd,
            isEven,
        };
    }

    async processPeriodResult(periodId: string): Promise<DiceResult | null> {
        try {
            const period = await prisma.k3Period.findUnique({
                where: { id: periodId },
            });

            if (!period) {
                logger.error(`K3 Period not found: ${periodId}`);
                return null;
            }

            if (period.status !== "ENDED") {
                logger.error(`K3 Period ${periodId} is not in ENDED status`);
                return null;
            }

            const result = await this.generateCompleteResult(periodId);

            await prisma.k3Period.update({
                where: { id: periodId },
                data: {
                    dice1: result.dice1,
                    dice2: result.dice2,
                    dice3: result.dice3,
                    sum: result.sum,
                    isTriple: result.isTriple,
                    isDouble: result.isDouble,
                    isAllDifferent: result.isAllDifferent,
                    isConsecutive: result.isConsecutive,
                    isBig: result.isBig,
                    isSmall: result.isSmall,
                    isOdd: result.isOdd,
                    isEven: result.isEven,
                },
            });

            WebSocketManager.publishToTopic("k3-results", {
                periodId,
                periodNumber: period.periodNumber,
                durationSeconds: period.durationSeconds,
                startTime: period.startTime,
                endTime: period.endTime,
                dice1: result.dice1,
                dice2: result.dice2,
                dice3: result.dice3,
                sum: result.sum,
                isTriple: result.isTriple,
                isDouble: result.isDouble,
                isAllDifferent: result.isAllDifferent,
                isConsecutive: result.isConsecutive,
                isBig: result.isBig,
                isSmall: result.isSmall,
                isOdd: result.isOdd,
                isEven: result.isEven,
            });

            logger.debug("Generated K3 result", {
                periodId,
                periodNumber: period.periodNumber,
                dice: [result.dice1, result.dice2, result.dice3],
                sum: result.sum,
                isTriple: result.isTriple,
                isDouble: result.isDouble,
                isAllDifferent: result.isAllDifferent,
                isConsecutive: result.isConsecutive,
                isBig: result.isBig,
                isSmall: result.isSmall,
                isOdd: result.isOdd,
                isEven: result.isEven,
            });

            return result;
        } catch (error) {
            logger.error(
                `Error processing K3 result for period ${periodId}:`,
                error
            );
            return null;
        }
    }

    async processAllEndedPeriods(): Promise<void> {
        try {
            const endedPeriods = await prisma.k3Period.findMany({
                where: {
                    status: "ENDED",
                    dice1: null,
                },
                orderBy: { endTime: "asc" },
            });

            for (const period of endedPeriods) {
                await this.processPeriodResult(period.id);
            }
        } catch (error) {
            logger.error("Error processing K3 ended periods:", error);
        }
    }
}
