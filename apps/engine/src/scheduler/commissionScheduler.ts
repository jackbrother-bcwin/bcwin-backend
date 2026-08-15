import cron, { ScheduledTask } from "node-cron";
import Logger from "@bcwin/logger";
// import { CommissionCalculator } from "../services/commission/commissionCalculator";

const logger = new Logger("commission-scheduler");

/**
 * Legacy commission daily aggregation.
 * ADR-0011: disabled — team earnings use RebateScheduler @ 01:30 IST only.
 */
export class CommissionScheduler {
    private task: ScheduledTask | null = null;
    private isTaskRunning = false;

    start(): void {
        logger.info(
            "Legacy Commission scheduler NOT started (rebate-only; ADR-0011)."
        );
        /*
        this.task = cron.schedule(
            "30 13 * * *",
            async () => {
                if (this.isTaskRunning) return;
                this.isTaskRunning = true;
                try {
                    const yesterday = new Date();
                    yesterday.setDate(yesterday.getDate() - 1);
                    await CommissionCalculator.aggregateDailyCommissions(yesterday);
                } catch (error) {
                    logger.error("Error in commission aggregation:", error);
                } finally {
                    this.isTaskRunning = false;
                }
            },
            { timezone: "Asia/Kolkata" }
        );
        this.task.start();
        */
    }

    stop(): void {
        if (this.task) {
            this.task.stop();
            this.task = null;
        }
    }

    async runManualAggregation(_date?: Date): Promise<void> {
        logger.warn(
            "runManualAggregation ignored — legacy commission disabled (ADR-0011)."
        );
    }
}
