import cron, { ScheduledTask } from "node-cron";
import Logger from "@bcwin/logger";
import { IpRiskLevelService } from "../services/ip/calculateRiskLevel";

const logger = new Logger("ip-risk-level-scheduler");

export class IpRiskLevelScheduler {
    private task: ScheduledTask | null = null;
    private isTaskRunning = false;

    start(): void {
        logger.info("Starting IP Risk Level scheduler...");

        // Run every hour (at the start of each hour)
        this.task = cron.schedule(
            "0 * * * *",
            async () => {
                if (this.isTaskRunning) {
                    logger.warn(
                        "Previous IP risk level calculation is still running. Skipping this run."
                    );
                    return;
                }

                this.isTaskRunning = true;
                try {
                    logger.info("Starting IP risk level calculation...");
                    await IpRiskLevelService.updateAllIpRiskLevels();
                    logger.info("IP risk level calculation completed.");
                } catch (error) {
                    logger.error("Error in IP risk level calculation:", error);
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
            "IP Risk Level scheduler started successfully. Recalculation runs every hour."
        );
    }

    stop(): void {
        logger.info("Stopping IP Risk Level scheduler...");
        if (this.task) {
            this.task.stop();
            this.task = null;
        }
        logger.info("IP Risk Level scheduler stopped.");
    }

    /**
     * Manual trigger for IP risk level recalculation. Useful for testing or immediate updates.
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
            logger.info("Running manual IP risk level recalculation...");
            await IpRiskLevelService.updateAllIpRiskLevels();
            logger.info("Manual IP risk level recalculation completed.");
        } catch (error) {
            logger.error("Error in manual IP risk level recalculation:", error);
        } finally {
            this.isTaskRunning = false;
        }
    }
}
