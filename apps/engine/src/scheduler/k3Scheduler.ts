import cron, { ScheduledTask } from "node-cron";

import Logger from "@bcwin/logger";

import { PeriodManager } from "../services/k3/periodManager";
import { ResultGenerator } from "../services/k3/resultGenerator";
import { BetSettlement } from "../services/k3/betSettlement";

const logger = new Logger("k3-scheduler");

/**
 * K3 game loop.
 *
 * MUST tick every second (not every 30s). A 30s cron leaves a multi-second
 * window with no ACTIVE period after endTime — clients show frozen 00.
 */
export class K3Scheduler {
    private periodManager: PeriodManager;
    private resultGenerator: ResultGenerator;
    private betSettlement: BetSettlement;
    private task: ScheduledTask | null = null;
    private isTaskRunning = false;

    constructor() {
        this.periodManager = new PeriodManager();
        this.resultGenerator = new ResultGenerator();
        this.betSettlement = new BetSettlement();
    }

    start(): void {
        logger.info("Starting K3 scheduler (1s tick)...");

        // Every second — seamless period handoff for 30s / 1m / 3m / 5m tables
        this.task = cron.schedule("* * * * * *", async () => {
            if (this.isTaskRunning) {
                // Skip overlapping ticks rather than queue; next second will catch up
                return;
            }

            this.isTaskRunning = true;
            try {
                await this.runCycle();
            } catch (error) {
                logger.error(
                    "An error occurred during the K3 scheduler cycle:",
                    error
                );
            } finally {
                this.isTaskRunning = false;
            }
        });

        this.task.start();
        logger.info("K3 scheduler started successfully with 1s cron.");
    }

    stop(): void {
        logger.info("Stopping K3 scheduler...");
        if (this.task) {
            this.task.stop();
            this.task = null;
        }
        logger.info("K3 scheduler stopped.");
    }

    /**
     * Sequential workflow: end → create → results → settle.
     */
    private async runCycle(): Promise<void> {
        await this.periodManager.endActivePeriods();
        await this.periodManager.createPeriodsForAllDurations();
        await this.resultGenerator.processAllEndedPeriods();
        await this.betSettlement.settleAllEndedPeriodsWithResults();
    }

    async runManualCycle(): Promise<void> {
        if (this.isTaskRunning) {
            logger.warn(
                "Cannot run manual K3 cycle: a task is already in progress."
            );
            return;
        }

        this.isTaskRunning = true;
        try {
            logger.info("Running manual K3 scheduler cycle...");
            await this.runCycle();
            logger.info("Manual K3 scheduler cycle completed.");
        } catch (error) {
            logger.error("Error in manual K3 scheduler cycle:", error);
        } finally {
            this.isTaskRunning = false;
        }
    }
}
