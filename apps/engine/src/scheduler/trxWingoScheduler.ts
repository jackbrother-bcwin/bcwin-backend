import Logger from "@bcwin/logger";

import { PeriodManager } from "../services/trxwingo/periodManager";
import {
    ResultGenerator,
    drawLeadMs,
    drawOffsetSeconds,
} from "../services/trxwingo/resultGenerator";
import { BetSettlement } from "../services/trxwingo/betSettlement";

const logger = new Logger("trx-wingo-scheduler");

/**
 * Discovery tick for period create / end / settle + arming sleep-to-deadline.
 * Precision for :54 comes from sleep-to-deadline in ResultGenerator, not from
 * interval phase luck. Default 1s — tight enough to catch the arm window.
 */
const TICK_MS = Number(process.env.TRX_SCHEDULER_TICK_MS ?? "1000");

export class TrxWingoScheduler {
    private periodManager: PeriodManager;
    private resultGenerator: ResultGenerator;
    private betSettlement: BetSettlement;
    private timer: ReturnType<typeof setInterval> | null = null;
    private isTaskRunning = false;

    constructor() {
        this.periodManager = new PeriodManager();
        this.resultGenerator = new ResultGenerator();
        this.betSettlement = new BetSettlement();
    }

    start(): void {
        const tickMs =
            Number.isFinite(TICK_MS) && TICK_MS >= 200 ? TICK_MS : 1000;

        logger.info("Starting TrxWingo scheduler…", {
            tickMs,
            drawOffsetSeconds: drawOffsetSeconds(),
            drawLeadMs: drawLeadMs(),
            mode: "sleep-to-deadline",
        });

        // Immediate bootstrap so periods exist without waiting first tick
        void this.safeCycle();

        this.timer = setInterval(() => {
            void this.safeCycle();
        }, tickMs);

        logger.info("TrxWingo scheduler started (sleep-to-deadline draws).");
    }

    stop(): void {
        logger.info("Stopping TrxWingo scheduler…");
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        logger.info("TrxWingo scheduler stopped.");
    }

    private async safeCycle(): Promise<void> {
        if (this.isTaskRunning) {
            // Do not skip silently forever — warn so ops can see pile-ups
            logger.warn(
                "Previous scheduler cycle still running — skipping tick."
            );
            return;
        }
        this.isTaskRunning = true;
        try {
            await this.runCycle();
        } catch (error) {
            logger.error("Scheduler cycle error:", error);
        } finally {
            this.isTaskRunning = false;
        }
    }

    /**
     * 1) Sleep-to-deadline draw at endTime−offset (or late catch-up)
     * 2) End ACTIVE periods past endTime
     * 3) Create next periods
     * 4) Settle ENDED periods that already have results
     */
    private async runCycle(): Promise<void> {
        // Draw first so we capture tip at exact drawAt when possible
        await this.resultGenerator.processAllDrawDuePeriods();

        await this.periodManager.endActivePeriods();

        await this.periodManager.createPeriodsForAllDurations();

        await this.betSettlement.settleAllEndedPeriodsWithResults();
    }

    async runManualCycle(): Promise<void> {
        if (this.isTaskRunning) {
            logger.warn(
                "Cannot run manual cycle: a task is already in progress."
            );
            return;
        }
        this.isTaskRunning = true;
        try {
            logger.info("Running manual scheduler cycle…");
            await this.runCycle();
            logger.info("Manual scheduler cycle completed.");
        } catch (error) {
            logger.error("Error in manual scheduler cycle:", error);
        } finally {
            this.isTaskRunning = false;
        }
    }
}
