import cron, { ScheduledTask } from "node-cron";
import Logger from "@bcwin/logger";
import { SelfRebateCalculator } from "@bcwin/rebate";

const logger = new Logger("self-rebate-scheduler");

export class SelfRebateScheduler {
    private task: ScheduledTask | null = null;
    private isTaskRunning = false;

    start(): void {
        logger.info("Starting Self-Rebate scheduler...");

        // Daily at 01:00 Asia/Kolkata — expire unclaimed self-rebates from previous days
        this.task = cron.schedule(
            "0 1 * * *",
            async () => {
                if (this.isTaskRunning) {
                    logger.warn(
                        "Previous self-rebate expiry is still running. Skipping this run."
                    );
                    return;
                }

                this.isTaskRunning = true;
                try {
                    await SelfRebateCalculator.expireUnclaimed();
                } catch (error) {
                    logger.error("Error in self-rebate expiry:", error);
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
            "Self-Rebate scheduler started. Daily expiry runs at 01:00 AM IST."
        );
    }

    stop(): void {
        logger.info("Stopping Self-Rebate scheduler...");
        if (this.task) {
            this.task.stop();
            this.task = null;
        }
        logger.info("Self-Rebate scheduler stopped.");
    }

    /**
     * Manual trigger for self-rebate expiry. Useful for testing or recovery.
     */
    async runManualExpiry(): Promise<void> {
        if (this.isTaskRunning) {
            logger.warn(
                "Cannot run manual expiry: a task is already in progress."
            );
            return;
        }

        this.isTaskRunning = true;
        try {
            logger.info("Running manual self-rebate expiry...");
            await SelfRebateCalculator.expireUnclaimed();
            logger.info("Manual self-rebate expiry completed.");
        } catch (error) {
            logger.error("Error in manual self-rebate expiry:", error);
        } finally {
            this.isTaskRunning = false;
        }
    }
}
