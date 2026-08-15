import cron, { ScheduledTask } from "node-cron";

import Logger from "@bcwin/logger";

import { FiveDPeriodManager } from "../services/5d/periodManager";
import { FiveDResultGenerator } from "../services/5d/resultGenerator";
import { FiveDSettlement } from "../services/5d/betSettlement";

const logger = new Logger("5d-scheduler");

/**
 * 5D game loop — 1s tick (same production handoff as K3).
 * A 30s cron leaves a multi-second gap with no ACTIVE period → sticky 00 on clients.
 */
export class FiveDScheduler {
    private periodManager: FiveDPeriodManager;
    private resultGenerator: FiveDResultGenerator;
    private betSettlement: FiveDSettlement;
    private task: ScheduledTask | null = null;
    private isTaskRunning = false;

    constructor() {
        this.periodManager = new FiveDPeriodManager();
        this.resultGenerator = new FiveDResultGenerator();
        this.betSettlement = new FiveDSettlement();
    }

    start(): void {
        logger.info("Starting 5D scheduler (1s tick)...");

        this.task = cron.schedule("* * * * * *", async () => {
            if (this.isTaskRunning) return;

            this.isTaskRunning = true;
            try {
                await this.runCycle();
            } catch (error) {
                logger.error(
                    "An error occurred during the 5D scheduler cycle:",
                    error
                );
            } finally {
                this.isTaskRunning = false;
            }
        });

        this.task.start();
        logger.info("5D scheduler started successfully with 1s cron.");
    }

    stop(): void {
        logger.info("Stopping 5D scheduler...");
        if (this.task) {
            this.task.stop();
            this.task = null;
        }
        logger.info("5D scheduler stopped.");
    }

    private async runCycle(): Promise<void> {
        await this.periodManager.endActivePeriods();
        await this.periodManager.createPeriodsForAllDurations();
        await this.resultGenerator.processAllEndedPeriods();
        await this.betSettlement.settleAllEndedPeriodsWithResults();
    }

    async runManualCycle(): Promise<void> {
        if (this.isTaskRunning) {
            logger.warn(
                "Cannot run manual 5D cycle: a task is already in progress."
            );
            return;
        }

        this.isTaskRunning = true;
        try {
            logger.info("Running manual 5D scheduler cycle...");
            await this.runCycle();
            logger.info("Manual 5D scheduler cycle completed.");
        } catch (error) {
            logger.error("Error in manual 5D scheduler cycle:", error);
        } finally {
            this.isTaskRunning = false;
        }
    }
}
