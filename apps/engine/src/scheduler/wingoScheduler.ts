import Logger from "@bcwin/logger";

import {
    PeriodManager,
    WINGO_DURATIONS,
} from "../services/wingo/periodManager";
import { ResultGenerator } from "../services/wingo/resultGenerator";
import { BetSettlement } from "../services/wingo/betSettlement";
import { prisma } from "@bcwin/db";

const logger = new Logger("wingo-scheduler");

/**
 * Win Go loop — 1s tick (same production handoff as K3/5D).
 *
 * Prepare (lock window): draw + persist (hidden) + pre-create next slot.
 * Handoff (endTime): publish result, announce next, never waits for settle.
 * Settle: background; may spill past 00. Clock never waits for money.
 */
export class WingoScheduler {
    private periodManager: PeriodManager;
    private resultGenerator: ResultGenerator;
    private betSettlement: BetSettlement;
    private timer: ReturnType<typeof setInterval> | null = null;
    private handoffRunning = false;
    private prepareRunning = false;
    private settleRunning = false;
    private announced = new Set<string>();
    private publishedResults = new Set<string>();

    constructor() {
        this.periodManager = new PeriodManager();
        this.resultGenerator = new ResultGenerator();
        this.betSettlement = new BetSettlement();
    }

    start(): void {
        logger.info("Starting Wingo scheduler (1s tick, lock prepare, 3s draw)...");
        void this.tick();
        this.timer = setInterval(() => {
            void this.tick();
        }, 1000);
    }

    stop(): void {
        logger.info("Stopping Wingo scheduler...");
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    private async tick(): Promise<void> {
        await this.handoff();
        void this.prepare();
        void this.settle();
    }

    /** Must stay cheap. Never skipped because prepare/settle are running. */
    private async handoff(): Promise<void> {
        if (this.handoffRunning) return;
        this.handoffRunning = true;
        const now = new Date();
        try {
            const justEnded = await this.periodManager.endExpiredPeriods(now);

            for (const period of justEnded) {
                if (this.publishedResults.has(period.id)) continue;
                if (period.resultNumber == null) {
                    const drawn = await this.resultGenerator.processPeriodResult(
                        period.id,
                        { publish: true }
                    );
                    if (drawn) this.publishedResults.add(period.id);
                    continue;
                }
                if (period.resultColor && period.resultSize) {
                    this.resultGenerator.publishResult(period, {
                        number: period.resultNumber,
                        color: period.resultColor,
                        size: period.resultSize,
                    });
                    this.publishedResults.add(period.id);
                }
            }

            for (const duration of WINGO_DURATIONS) {
                let live = await this.periodManager.getLivePeriod(
                    duration,
                    now
                );
                if (!live) {
                    live = await this.periodManager.createPeriodIfNeeded(
                        duration,
                        now,
                        { announce: false }
                    );
                }
                if (live && !this.announced.has(live.id)) {
                    if (live.startTime.getTime() <= now.getTime()) {
                        this.periodManager.announcePeriod(live);
                        this.announced.add(live.id);
                    }
                }
            }

            await prisma.wingoPeriod.updateMany({
                where: {
                    status: "ENDED",
                    resultNumber: { not: null },
                    wingoBets: { none: { status: "PENDING" } },
                },
                data: { status: "RESOLVED" },
            });
        } catch (error) {
            logger.error("Wingo handoff failed:", error);
        } finally {
            this.handoffRunning = false;
        }
    }

    /**
     * Lock window: pre-create next slot (speed).
     * Last 3s: persist hidden draw so admin can still change Redis until then.
     */
    private async prepare(): Promise<void> {
        if (this.prepareRunning) return;
        this.prepareRunning = true;
        const now = new Date();
        try {
            for (const duration of WINGO_DURATIONS) {
                const live = await this.periodManager.getLivePeriod(
                    duration,
                    now
                );
                if (!live) continue;
                if (this.periodManager.isInLockWindow(live, now)) {
                    await this.periodManager.ensureNextPeriod(
                        duration,
                        live.endTime
                    );
                }
                if (
                    live.resultNumber == null &&
                    this.periodManager.isInResultDrawWindow(live, now)
                ) {
                    await this.resultGenerator.processPeriodResult(live.id, {
                        publish: false,
                    });
                }
            }
        } catch (error) {
            logger.error("Wingo prepare failed:", error);
        } finally {
            this.prepareRunning = false;
        }
    }

    private async settle(): Promise<void> {
        if (this.settleRunning) return;
        this.settleRunning = true;
        try {
            await this.betSettlement.settleAllEndedPeriodsWithResults();
        } catch (error) {
            logger.error("Wingo settle failed:", error);
        } finally {
            this.settleRunning = false;
        }
    }

    async runManualCycle(): Promise<void> {
        await this.tick();
    }
}
