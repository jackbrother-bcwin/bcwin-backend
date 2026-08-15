import cron, { ScheduledTask } from "node-cron";
import Logger from "@bcwin/logger";
import {
    expireOldBonuses,
    checkAndCreateInvitationBonuses,
} from "@bcwin/activity-bonus";

const logger = new Logger("activity-bonus-scheduler");

export class ActivityBonusScheduler {
    private expirationTask: ScheduledTask | null = null;
    private invitationTask: ScheduledTask | null = null;
    private isExpirationRunning = false;
    private isInvitationRunning = false;

    start(): void {
        logger.info("Starting Activity Bonus scheduler...");

        // Hourly: Expire old bonuses
        this.expirationTask = cron.schedule(
            "0 * * * *",
            async () => {
                if (this.isExpirationRunning) {
                    logger.warn(
                        "Previous expiration task is still running. Skipping this run."
                    );
                    return;
                }

                this.isExpirationRunning = true;
                try {
                    logger.info("Starting bonus expiration check...");
                    await expireOldBonuses();
                    logger.info("Bonus expiration check completed.");
                } catch (error) {
                    logger.error("Error in bonus expiration:", error);
                } finally {
                    this.isExpirationRunning = false;
                }
            },
            {
                timezone: "Asia/Kolkata",
            }
        );

        // Daily at 1:00 AM IST (19:30 UTC, accounting for IST = UTC+5:30)
        // Check invitation bonuses for all users
        this.invitationTask = cron.schedule(
            "30 19 * * *",
            async () => {
                if (this.isInvitationRunning) {
                    logger.warn(
                        "Previous invitation bonus check is still running. Skipping this run."
                    );
                    return;
                }

                this.isInvitationRunning = true;
                try {
                    logger.info(
                        "Starting daily invitation bonus check for all users..."
                    );
                    await checkAndCreateInvitationBonuses();
                    logger.info("Daily invitation bonus check completed.");
                } catch (error) {
                    logger.error("Error in invitation bonus check:", error);
                } finally {
                    this.isInvitationRunning = false;
                }
            },
            {
                timezone: "Asia/Kolkata",
            }
        );

        this.expirationTask.start();
        this.invitationTask.start();

        logger.info(
            "Activity Bonus scheduler started successfully. Expiration runs hourly, invitation bonus check runs daily at 1:00 AM IST."
        );
    }

    stop(): void {
        logger.info("Stopping Activity Bonus scheduler...");

        if (this.expirationTask) {
            this.expirationTask.stop();
            this.expirationTask = null;
        }

        if (this.invitationTask) {
            this.invitationTask.stop();
            this.invitationTask = null;
        }

        logger.info("Activity Bonus scheduler stopped.");
    }

    /**
     * Manual trigger for expiration. Useful for testing or recovery.
     */
    async runManualExpiration(): Promise<void> {
        if (this.isExpirationRunning) {
            logger.warn(
                "Cannot run manual expiration: a task is already in progress."
            );
            return;
        }

        this.isExpirationRunning = true;
        try {
            logger.info("Running manual bonus expiration...");
            await expireOldBonuses();
            logger.info("Manual bonus expiration completed.");
        } catch (error) {
            logger.error("Error in manual bonus expiration:", error);
        } finally {
            this.isExpirationRunning = false;
        }
    }

    /**
     * Manual trigger for invitation bonus check. Useful for testing or recovery.
     */
    async runManualInvitationCheck(): Promise<void> {
        if (this.isInvitationRunning) {
            logger.warn(
                "Cannot run manual invitation check: a task is already in progress."
            );
            return;
        }

        this.isInvitationRunning = true;
        try {
            logger.info("Running manual invitation bonus check...");
            await checkAndCreateInvitationBonuses();
            logger.info("Manual invitation bonus check completed.");
        } catch (error) {
            logger.error("Error in manual invitation bonus check:", error);
        } finally {
            this.isInvitationRunning = false;
        }
    }
}
