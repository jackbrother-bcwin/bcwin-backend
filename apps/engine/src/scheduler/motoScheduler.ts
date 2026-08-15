import cron, { ScheduledTask } from "node-cron";

import Logger from "@bcwin/logger";

import { MotoPeriodManager } from "../services/moto/periodManager";
import { MotoResultGenerator } from "../services/moto/resultGenerator";
import { MotoBetSettlement } from "../services/moto/betSettlement";

const logger = new Logger("moto-scheduler");

export class MotoScheduler {
    private periodManager: MotoPeriodManager;
    private resultGenerator: MotoResultGenerator;
    private betSettlement: MotoBetSettlement;
    private task: ScheduledTask | null = null;
    private isTaskRunning = false; // A lock to prevent concurrent runs

    constructor() {
        this.periodManager = new MotoPeriodManager();
        this.resultGenerator = new MotoResultGenerator();
        this.betSettlement = new MotoBetSettlement();
    }

    start(): void {
        logger.info("Starting Moto Racing scheduler...");

        // This cron job runs every 30 seconds (at :00 and :30 of every minute).
        // This is the primary tick for our entire game loop.
        this.task = cron.schedule("*/30 * * * * *", async () => {
            if (this.isTaskRunning) {
                logger.warn(
                    "Previous moto scheduler cycle is still running. Skipping this tick."
                );
                return;
            }

            this.isTaskRunning = true;
            try {
                // We add a small delay (e.g., 1 second) to ensure the period has definitively ended
                // before we start processing. This helps avoid edge cases with clock synchronization.
                await new Promise((resolve) => setTimeout(resolve, 1000));

                logger.info("Starting moto scheduler cycle...");
                await this.runCycle();
                logger.info("Moto scheduler cycle completed.");
            } catch (error) {
                logger.error(
                    "An error occurred during the moto scheduler cycle:",
                    error
                );
            } finally {
                this.isTaskRunning = false;
            }
        });

        this.task.start();
        logger.info("Moto Racing scheduler started successfully with cron job.");
    }

    stop(): void {
        logger.info("Stopping Moto Racing scheduler...");
        if (this.task) {
            this.task.stop();
            this.task = null;
        }
        logger.info("Moto Racing scheduler stopped.");
    }

    /**
     * Executes the full, sequential workflow for the Moto Racing game.
     * This ensures that operations happen in the correct, logical order.
     */
    private async runCycle(): Promise<void> {
        // 1. End any periods whose endTime has passed.
        await this.periodManager.endActivePeriods();

        // 2. Create new periods for all durations if they don't exist yet for the current time slot.
        // This ensures the next game is always ready.
        await this.periodManager.createPeriodsForAllDurations();

        // 3. Find all "ENDED" periods and generate their results.
        await this.resultGenerator.processAllEndedPeriods();

        // 4. Find all periods with results and settle their bets.
        await this.betSettlement.settleAllEndedPeriodsWithResults();
    }

    /**
     * A manual trigger for the entire cycle. Useful for testing or recovery.
     */
    async runManualCycle(): Promise<void> {
        if (this.isTaskRunning) {
            logger.warn(
                "Cannot run manual moto cycle: a task is already in progress."
            );
            return;
        }

        this.isTaskRunning = true;
        try {
            logger.info("Running manual moto scheduler cycle...");
            await this.runCycle();
            logger.info("Manual moto scheduler cycle completed.");
        } catch (error) {
            logger.error("Error in manual moto scheduler cycle:", error);
        } finally {
            this.isTaskRunning = false;
        }
    }
}