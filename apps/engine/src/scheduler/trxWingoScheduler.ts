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
    private lifecycleRunning = false;
    private drawRunning = false;
    private settleRunning = false;

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
        if (this.lifecycleRunning) {
            logger.warn(
                "Previous TRX period handoff still running — skipping tick."
            );
            return;
        }
        this.lifecycleRunning = true;
        try {
            // Keep the clock lifecycle independent from chain/provider latency.
            await this.periodManager.endActivePeriods();
            await this.periodManager.createPeriodsForAllDurations();
        } catch (error) {
            logger.error("TRX period handoff error:", error);
        } finally {
            this.lifecycleRunning = false;
        }

        void this.drawDuePeriods();
        void this.settleEndedPeriods();
    }

    private async drawDuePeriods(): Promise<void> {
        if (this.drawRunning) return;
        this.drawRunning = true;
        try {
            await this.resultGenerator.processAllDrawDuePeriods();
        } catch (error) {
            logger.error("TRX draw cycle error:", error);
        } finally {
            this.drawRunning = false;
        }
    }

    private async settleEndedPeriods(): Promise<void> {
        if (this.settleRunning) return;
        this.settleRunning = true;
        try {
            await this.betSettlement.settleAllEndedPeriodsWithResults();
        } catch (error) {
            logger.error("TRX settlement cycle error:", error);
        } finally {
            this.settleRunning = false;
        }
    }

    async runManualCycle(): Promise<void> {
        if (this.lifecycleRunning || this.drawRunning) {
            logger.warn(
                "Cannot run manual cycle: a task is already in progress."
            );
            return;
        }
        this.lifecycleRunning = true;
        try {
            logger.info("Running manual scheduler cycle…");
            await this.periodManager.endActivePeriods();
            await this.periodManager.createPeriodsForAllDurations();
            this.lifecycleRunning = false;
            await this.drawDuePeriods();
            await this.settleEndedPeriods();
            logger.info("Manual scheduler cycle completed.");
        } catch (error) {
            logger.error("Error in manual scheduler cycle:", error);
        } finally {
            this.lifecycleRunning = false;
        }
    }
}
