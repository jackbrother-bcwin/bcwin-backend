import cron, { ScheduledTask } from "node-cron";
import Logger from "@bcwin/logger";
import { DailyTeamRebate, shiftYmdIst, ymdIst } from "@bcwin/rebate";

const logger = new Logger("rebate-scheduler");

export class RebateScheduler {
    private task: ScheduledTask | null = null;
    private isTaskRunning = false;

    start(): void {
        logger.info("Starting Rebate scheduler...");

        // IST 00:00 — close the day that just ended (ADR-0036)
        this.task = cron.schedule(
            "0 0 * * *",
            async () => {
                await this.closeYesterday({ resetRebateLevel: true });
            },
            {
                timezone: "Asia/Kolkata",
            }
        );

        this.task.start();
        void this.catchUpMissedClose();

        logger.info(
            "Rebate scheduler started. Closes the IST day at 00:00 (qualify level, credit Agent commission, reset rebateLevel to 0)."
        );
    }

    private async closeYesterday(opts: {
        resetRebateLevel: boolean;
    }): Promise<void> {
        if (this.isTaskRunning) {
            logger.warn(
                "Previous rebate settlement is still running. Skipping this run."
            );
            return;
        }

        this.isTaskRunning = true;
        try {
            const closed = shiftYmdIst(ymdIst(), -1);
            await DailyTeamRebate.processClosedIstDay(closed, opts);
        } catch (error) {
            logger.error("Error in rebate settlement:", error);
        } finally {
            this.isTaskRunning = false;
        }
    }

    /**
     * node-cron does not replay a missed 00:00 tick (deploy / engine restart).
     * If yesterday has bets and no Agent commission rows, close it now without
     * wiping today's rebateLevel.
     */
    private async catchUpMissedClose(): Promise<void> {
        try {
            const closed = shiftYmdIst(ymdIst(), -1);
            if (!(await DailyTeamRebate.needsClose(closed))) return;
            logger.warn(
                `Missed IST 00:00 close for ${closed}; running catch-up (no rebateLevel reset)`
            );
            await this.closeYesterday({ resetRebateLevel: false });
        } catch (error) {
            logger.error("Rebate close catch-up failed:", error);
        }
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
            const closed = shiftYmdIst(ymdIst(), -1);
            await DailyTeamRebate.processClosedIstDay(closed);
            logger.info("Manual rebate settlement completed.");
        } catch (error) {
            logger.error("Error in manual rebate settlement:", error);
        } finally {
            this.isTaskRunning = false;
        }
    }
}
