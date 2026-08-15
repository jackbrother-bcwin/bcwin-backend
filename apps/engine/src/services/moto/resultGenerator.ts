import { ResultSetter } from "@bcwin/cache";
import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { WebSocketManager } from "@bcwin/websocket";

const logger = new Logger("moto-result-generator");

interface RaceResults {
    firstPlace: number;
    secondPlace: number;
    thirdPlace: number;
}

export class MotoResultGenerator {
    generateRaceResults(): RaceResults {
        const bikes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

        // Shuffle array using Fisher-Yates algorithm
        for (let i = bikes.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [bikes[i], bikes[j]] = [bikes[j], bikes[i]];
        }

        return {
            firstPlace: bikes[0],
            secondPlace: bikes[1],
            thirdPlace: bikes[2],
        };
    }

    validateResultUniqueness(results: RaceResults): boolean {
        const positions = [
            results.firstPlace,
            results.secondPlace,
            results.thirdPlace,
        ];
        const uniquePositions = new Set(positions);

        // Check if all positions are unique and within valid range (1-10)
        return (
            uniquePositions.size === 3 &&
            positions.every((pos) => pos >= 1 && pos <= 10)
        );
    }

    async generateCompleteResult(periodId: string): Promise<RaceResults> {
        const adminResult = await ResultSetter.get("moto", periodId);

        let results: RaceResults;

        if (
            adminResult &&
            typeof adminResult.firstPlace === "number" &&
            typeof adminResult.secondPlace === "number" &&
            typeof adminResult.thirdPlace === "number"
        ) {
            results = {
                firstPlace: adminResult.firstPlace,
                secondPlace: adminResult.secondPlace,
                thirdPlace: adminResult.thirdPlace,
            };

            logger.debug("Admin has manually set the moto result", {
                periodId,
                results,
            });
            await ResultSetter.del("moto", periodId);
        } else {
            results = this.generateRaceResults();
        }

        // Validate results before returning
        if (!this.validateResultUniqueness(results)) {
            logger.error(
                "Generated invalid race results (duplicates found), regenerating...",
                {
                    periodId,
                    invalidResults: results,
                }
            );
            // Regenerate if validation fails
            results = this.generateRaceResults();
        }

        return results;
    }

    async processPeriodResult(periodId: string): Promise<RaceResults | null> {
        try {
            const period = await prisma.motoPeriod.findUnique({
                where: { id: periodId },
            });

            if (!period) {
                logger.error(`Moto period not found: ${periodId}`);
                return null;
            }

            if (period.status !== "ENDED") {
                logger.error(`Moto period ${periodId} is not in ENDED status`);
                return null;
            }

            const results = await this.generateCompleteResult(periodId);

            await prisma.motoPeriod.update({
                where: { id: periodId },
                data: {
                    firstPlace: results.firstPlace,
                    secondPlace: results.secondPlace,
                    thirdPlace: results.thirdPlace,
                },
            });

            WebSocketManager.publishToTopic("moto-results", {
                periodId,
                periodNumber: period.periodNumber,
                durationSeconds: period.durationSeconds,
                startTime: period.startTime,
                endTime: period.endTime,
                firstPlace: results.firstPlace,
                secondPlace: results.secondPlace,
                thirdPlace: results.thirdPlace,
            });

            logger.debug("Generated moto race result", {
                periodId,
                periodNumber: period.periodNumber,
                firstPlace: results.firstPlace,
                secondPlace: results.secondPlace,
                thirdPlace: results.thirdPlace,
            });

            return results;
        } catch (error) {
            logger.error(
                `Error processing moto result for period ${periodId}:`,
                error
            );
            return null;
        }
    }

    async processAllEndedPeriods(): Promise<void> {
        try {
            const endedPeriods = await prisma.motoPeriod.findMany({
                where: {
                    status: "ENDED",
                    firstPlace: null,
                },
                orderBy: { endTime: "asc" },
            });

            for (const period of endedPeriods) {
                await this.processPeriodResult(period.id);
            }
        } catch (error) {
            logger.error("Error processing ended moto periods:", error);
        }
    }

    getResultDescription(results: RaceResults): string {
        return `1st: ${results.firstPlace}, 2nd: ${results.secondPlace}, 3rd: ${results.thirdPlace}`;
    }
}
