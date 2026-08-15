import cron, { ScheduledTask } from "node-cron";

import Logger from "@bcwin/logger";

import { PeriodManager } from "../services/wingo/periodManager";
import { ResultGenerator } from "../services/wingo/resultGenerator";
import { BetSettlement } from "../services/wingo/betSettlement";

const logger = new Logger("wingo-scheduler");

export class WingoScheduler {
    private periodManager: PeriodManager;
    private resultGenerator: ResultGenerator;
    private betSettlement: BetSettlement;
    private task: ScheduledTask | null = null;
    private isTaskRunning = false; // A lock to prevent concurrent runs

    constructor() {
        this.periodManager = new PeriodManager();
        this.resultGenerator = new ResultGenerator();
        this.betSettlement = new BetSettlement();
    }

    start(): void {
        logger.info("Starting Wingo scheduler...");

        // This cron job runs every 30 seconds (at :00 and :30 of every minute).
        // This is the primary tick for our entire game loop.
        this.task = cron.schedule("*/30 * * * * *", async () => {
            if (this.isTaskRunning) {
                logger.warn(
                    "Previous scheduler cycle is still running. Skipping this tick."
                );
                return;
            }

            this.isTaskRunning = true;
            try {
                // We add a small delay (e.g., 1 second) to ensure the period has definitively ended
                // before we start processing. This helps avoid edge cases with clock synchronization.
                await new Promise((resolve) => setTimeout(resolve, 1000));

                logger.info("Starting scheduler cycle...");
                await this.runCycle();
                logger.info("Scheduler cycle completed.");
            } catch (error) {
                logger.error(
                    "An error occurred during the scheduler cycle:",
                    error
                );
            } finally {
                this.isTaskRunning = false;
            }
        });

        this.task.start();
        logger.info("Wingo scheduler started successfully with cron job.");
    }

    stop(): void {
        logger.info("Stopping Wingo scheduler...");
        if (this.task) {
            this.task.stop();
            this.task = null;
        }
        logger.info("Wingo scheduler stopped.");
    }

    /**
     * Executes the full, sequential workflow for the Wingo game.
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
                "Cannot run manual cycle: a task is already in progress."
            );
            return;
        }

        this.isTaskRunning = true;
        try {
            logger.info("Running manual scheduler cycle...");
            await this.runCycle();
            logger.info("Manual scheduler cycle completed.");
        } catch (error) {
            logger.error("Error in manual scheduler cycle:", error);
        } finally {
            this.isTaskRunning = false;
        }
    }
}
