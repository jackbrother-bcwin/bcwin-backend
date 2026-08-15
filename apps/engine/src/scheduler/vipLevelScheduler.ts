import cron, { ScheduledTask } from "node-cron";
import Logger from "@bcwin/logger";
import { VipLevelService } from "../services/vip/vipLevelService";

const logger = new Logger("vip-level-scheduler");

export class VipLevelScheduler {
    private task: ScheduledTask | null = null;
    private isTaskRunning = false;

    start(): void {
        logger.info("Starting VIP Level scheduler...");

        // Daily at 2:00 AM IST (20:30 UTC previous day)
        // This runs before commission aggregation (12:30 IST)
        this.task = cron.schedule(
            "30 20 * * *",
            async () => {
                if (this.isTaskRunning) {
                    logger.warn(
                        "Previous VIP level calculation is still running. Skipping this run."
                    );
                    return;
                }

                this.isTaskRunning = true;
                try {
                    logger.info("Starting VIP level recalculation...");
                    await VipLevelService.updateAllUserVipLevels();
                    logger.info("VIP level recalculation completed.");
                } catch (error) {
                    logger.error("Error in VIP level calculation:", error);
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
            "VIP Level scheduler started successfully. Daily recalculation runs at 2:00 AM IST."
        );
    }

    stop(): void {
        logger.info("Stopping VIP Level scheduler...");
        if (this.task) {
            this.task.stop();
            this.task = null;
        }
        logger.info("VIP Level scheduler stopped.");
    }

    /**
     * Manual trigger for VIP level recalculation. Useful for testing or recovery.
     */
    async runManualRecalculation(): Promise<void> {
        if (this.isTaskRunning) {
            logger.warn(
                "Cannot run manual recalculation: a task is already in progress."
            );
            return;
        }

        this.isTaskRunning = true;
        try {
            logger.info("Running manual VIP level recalculation...");
            await VipLevelService.updateAllUserVipLevels();
            logger.info("Manual VIP level recalculation completed.");
        } catch (error) {
            logger.error("Error in manual VIP level recalculation:", error);
        } finally {
            this.isTaskRunning = false;
        }
    }
}
