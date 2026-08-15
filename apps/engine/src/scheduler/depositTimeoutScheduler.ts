import cron, { ScheduledTask } from "node-cron";
import Logger from "@bcwin/logger";
import { prisma, PaymentOrderStatus } from "@bcwin/db";

const logger = new Logger("deposit-timeout-scheduler");

/** Recharges stuck in PROCESSING longer than this become FAILED */
export const DEPOSIT_PROCESSING_TIMEOUT_MS = 1.3 * 60 * 60 * 1000; // 1.3 hours

/**
 * Mark PROCESSING deposits older than the timeout as FAILED.
 * Safe to re-run: only touches still-PROCESSING rows past the cutoff.
 */
export async function failStaleProcessingDeposits(): Promise<number> {
    const cutoff = new Date(Date.now() - DEPOSIT_PROCESSING_TIMEOUT_MS);

    // Only flip status — do not wipe gateway metadata on the row
    const result = await prisma.deposit.updateMany({
        where: {
            status: PaymentOrderStatus.PROCESSING,
            createdAt: { lt: cutoff },
        },
        data: {
            status: PaymentOrderStatus.FAILED,
        },
    });

    return result.count;
}

export class DepositTimeoutScheduler {
    private task: ScheduledTask | null = null;
    private isRunning = false;

    start(): void {
        logger.info(
            "Starting Deposit Timeout scheduler (fail PROCESSING after 1.3h)..."
        );

        // Every 5 minutes
        this.task = cron.schedule(
            "*/5 * * * *",
            async () => {
                if (this.isRunning) {
                    logger.warn(
                        "Previous deposit timeout job still running. Skipping."
                    );
                    return;
                }

                this.isRunning = true;
                try {
                    const n = await failStaleProcessingDeposits();
                    if (n > 0) {
                        logger.info(
                            `Auto-failed ${n} deposit(s) stuck in PROCESSING > 1.3h`
                        );
                    }
                } catch (error) {
                    logger.error("Error failing stale deposits:", error);
                } finally {
                    this.isRunning = false;
                }
            },
            { timezone: "Asia/Kolkata" }
        );

        this.task.start();

        // Run once shortly after boot so backlog clears without waiting 5 min
        void this.runOnce();

        logger.info(
            "Deposit Timeout scheduler started (every 5 min + boot pass)."
        );
    }

    stop(): void {
        logger.info("Stopping Deposit Timeout scheduler...");
        if (this.task) {
            this.task.stop();
            this.task = null;
        }
        logger.info("Deposit Timeout scheduler stopped.");
    }

    async runOnce(): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;
        try {
            const n = await failStaleProcessingDeposits();
            if (n > 0) {
                logger.info(
                    `Boot/manual: auto-failed ${n} stale PROCESSING deposit(s)`
                );
            }
        } catch (error) {
            logger.error("Error in deposit timeout runOnce:", error);
        } finally {
            this.isRunning = false;
        }
    }
}
