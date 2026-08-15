import cron, { ScheduledTask } from "node-cron";
import Logger from "@bcwin/logger";
import { RebateCalculator } from "@bcwin/rebate";

const logger = new Logger("rebate-scheduler");

export class RebateScheduler {
    private task: ScheduledTask | null = null;
    private isTaskRunning = false;

    start(): void {
        logger.info("Starting Rebate scheduler...");

        // Daily at 01:30 Asia/Kolkata — credit all unsettled team rebates (ADR-0011)
        this.task = cron.schedule(
            "30 1 * * *",
            async () => {
                if (this.isTaskRunning) {
                    logger.warn(
                        "Previous rebate settlement is still running. Skipping this run."
                    );
                    return;
                }

                this.isTaskRunning = true;
                try {
                    await RebateCalculator.settleAllUnsettledRebates();
                } catch (error) {
                    logger.error("Error in rebate settlement:", error);
                } finally {
                    this.isTaskRunning = false;
                }
            },
            {
                timezone: "Asia/Kolkata",
            }
        );

        this.task.start();

        logger.info(
            "Rebate scheduler started. Daily settlement runs at 01:30 AM IST (rebate-only commission)."
        );
    }

    stop(): void {
        logger.info("Stopping Rebate scheduler...");
        if (this.task) {
            this.task.stop();
            this.task = null;
        }
        logger.info("Rebate scheduler stopped.");
    }

    /**
     * Manual trigger for rebate settlement. Useful for testing or recovery.
     */
    async runManualSettlement(): Promise<void> {
        if (this.isTaskRunning) {
            logger.warn(
                "Cannot run manual settlement: a task is already in progress."
            );
            return;
        }

        this.isTaskRunning = true;
        try {
            logger.info("Running manual rebate settlement...");
            await RebateCalculator.settleAllUnsettledRebates();
            logger.info("Manual rebate settlement completed.");
        } catch (error) {
            logger.error("Error in manual rebate settlement:", error);
        } finally {
            this.isTaskRunning = false;
        }
    }
}
