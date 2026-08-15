import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { WebSocketManager } from "@bcwin/websocket";
import type { WingoResultColor, WingoResultSize } from "@bcwin/db";
import {
    getLatestBlock,
    getTipAtOrAfter,
    type LatestBlock,
} from "./tron";

const logger = new Logger("trx-wingo-result-generator");

/** Draw at endTime − offset (default 6s → second 54 of a 60s period). */
export function drawOffsetSeconds(): number {
    const n = Number(process.env.TRX_DRAW_OFFSET_SECONDS ?? "6");
    return Number.isFinite(n) && n >= 0 ? n : 6;
}

/**
 * Optional lead so we fire slightly before wall drawAt (ms).
 * Use if server clock runs behind competitors (~1s): e.g. TRX_DRAW_LEAD_MS=1000.
 * Default 0 — prefer NTP sync over permanent lead.
 */
export function drawLeadMs(): number {
    const n = Number(process.env.TRX_DRAW_LEAD_MS ?? "0");
    return Number.isFinite(n) && n >= 0 ? Math.min(n, 5000) : 0;
}

/** Max sleep inside a cycle while waiting for exact drawAt (ms). */
function maxSleepMs(): number {
    const tick = Number(process.env.TRX_SCHEDULER_TICK_MS ?? "1000");
    const base = Number.isFinite(tick) && tick >= 200 ? tick : 1000;
    // Allow a little past one tick so we can land on the deadline cleanly
    return Math.min(Math.max(base + 200, 500), 2500);
}

/** How far ahead we look for an upcoming draw to arm sleep-to-deadline. */
function armHorizonMs(): number {
    return maxSleepMs();
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

interface PeriodResult {
    number: number;
    color: WingoResultColor;
    size: WingoResultSize;
    blockNumber: number;
    blockHash: string;
    blockTimestamp: number;
}

export class ResultGenerator {
    /**
     * Primary color from parity (all digits):
     * even (0,2,4,6,8) → RED · odd (1,3,5,7,9) → GREEN
     * Digits 0 & 5 also pay VIOLET as a special color bet (see GameLogic).
     */
    calculateResultColor(number: number): WingoResultColor {
        return number % 2 === 0 ? "RED" : "GREEN";
    }

    calculateResultSize(number: number): WingoResultSize {
        return number >= 5 ? "BIG" : "SMALL";
    }

    /**
     * Absolute draw instant for a period (wall clock).
     * drawAt = endTime − offset − lead
     */
    drawAtMs(endTime: Date): number {
        return (
            endTime.getTime() -
            drawOffsetSeconds() * 1000 -
            drawLeadMs()
        );
    }

    /**
     * Industry-common TRX-Wingo: last decimal digit appearing in block hash.
     */
    private digitFromBlockHash(hash: string, blockNumber: number): number {
        if (hash) {
            const lastDecimal = hash.match(/\d(?=[^\d]*$)/);
            if (lastDecimal) return parseInt(lastDecimal[0], 10);
            const lastHex = hash.slice(-1);
            if (/[0-9a-fA-F]/.test(lastHex)) {
                return parseInt(lastHex, 16) % 10;
            }
        }
        return Math.abs(blockNumber) % 10;
    }

    async generateCompleteResult(
        prefetchedBlock?: LatestBlock
    ): Promise<PeriodResult> {
        // Prefer caller-supplied block so N periods share one tip fetch
        let block = prefetchedBlock;
        if (!block) {
            try {
                block = await getLatestBlock({ force: true });
            } catch (first) {
                logger.warn(
                    "getLatestBlock failed, retrying once after delay…",
                    first
                );
                await new Promise((r) => setTimeout(r, 5000));
                block = await getLatestBlock({ force: true });
            }
        }

        logger.debug("TRX draw tip block", block);
        const number = this.digitFromBlockHash(block.hash, block.number);

        return {
            number,
            color: this.calculateResultColor(number),
            size: this.calculateResultSize(number),
            blockNumber: block.number,
            blockHash: block.hash,
            blockTimestamp: block.timestamp,
        };
    }

    /**
     * Generate + store result for a period that is due for draw
     * (now >= drawAt). Never draws early.
     */
    async processPeriodResult(
        periodId: string,
        prefetchedBlock?: LatestBlock
    ): Promise<PeriodResult | null> {
        try {
            const period = await prisma.trxWingoPeriod.findUnique({
                where: { id: periodId },
            });

            if (!period) {
                logger.error(`Period not found: ${periodId}`);
                return null;
            }

            if (period.resultNumber != null) {
                return null;
            }

            if (period.status === "RESOLVED") {
                return null;
            }

            const drawAt = this.drawAtMs(period.endTime);
            const nowBefore = Date.now();
            // Hard no-early — even 1ms early is refused
            if (nowBefore < drawAt) {
                logger.debug("TRX draw refused (early)", {
                    periodNumber: period.periodNumber,
                    deltaMs: nowBefore - drawAt,
                });
                return null;
            }

            const result = await this.generateCompleteResult(prefetchedBlock);

            const drawnAt = Date.now();
            const deltaMs = drawnAt - drawAt;
            const elapsedSec = Math.max(
                0,
                (drawnAt - period.startTime.getTime()) / 1000
            );
            const periodSecond = Math.floor(elapsedSec);
            const blockPeriodSecond =
                (result.blockTimestamp - period.startTime.getTime()) / 1000;
            const expectedBlocks =
                Number(process.env.TRX_EXPECTED_BLOCKS_PER_MINUTE ?? "20") *
                (period.durationSeconds / 60);

            await prisma.trxWingoPeriod.update({
                where: { id: periodId },
                data: {
                    resultNumber: result.number,
                    resultColor: result.color,
                    resultSize: result.size,
                    blockNumber: result.blockNumber,
                    blockHash: result.blockHash,
                    blockTimestamp: result.blockTimestamp.toString(),
                },
            });

            WebSocketManager.publishToTopic("trx-wingo-results", {
                periodId,
                periodNumber: period.periodNumber,
                durationSeconds: period.durationSeconds,
                startTime: period.startTime,
                endTime: period.endTime,
                number: result.number,
                color: result.color,
                size: result.size,
                blockNumber: result.blockNumber,
                blockHash: result.blockHash,
            });

            logger.info("TRX draw result", {
                periodId,
                periodNumber: period.periodNumber,
                durationSeconds: period.durationSeconds,
                number: result.number,
                color: result.color,
                size: result.size,
                blockNumber: result.blockNumber,
                blockHashTail: result.blockHash.slice(-5),
                /** Wall-clock second into period when we locked */
                periodSecond,
                /** Block's own time as second into period (want ~54, was stuck at 51) */
                blockPeriodSecond: +blockPeriodSecond.toFixed(2),
                blockTime: new Date(result.blockTimestamp).toISOString(),
                /** ms after scheduled drawAt when lock completed */
                deltaMs,
                drawAt: new Date(drawAt).toISOString(),
                drawnAt: new Date(drawnAt).toISOString(),
                leadMs: drawLeadMs(),
                offsetSec: drawOffsetSeconds(),
                expectedBlocksApprox: Math.round(expectedBlocks),
                pastEnd: drawnAt > period.endTime.getTime(),
                timing:
                    deltaMs <= 500
                        ? "on-time"
                        : deltaMs <= 1500
                          ? "slightly-late"
                          : "late",
            });

            return result;
        } catch (error) {
            logger.error(
                `Error processing result for period ${periodId}:`,
                error
            );
            return null;
        }
    }

    /**
     * Industry-grade Option B + tip-at-or-after:
     * 1) Sleep until wall drawAt (:54)
     * 2) Poll chain tip until block.timestamp >= drawAt (catch :54 block, not :51)
     * 3) One shared tip for all due durations this tick
     * 4) Late catch-up if we missed the window
     */
    async processAllDrawDuePeriods(): Promise<void> {
        try {
            const offsetMs = drawOffsetSeconds() * 1000 + drawLeadMs();
            const horizon = armHorizonMs();
            // endTime <= now + offset + horizon  ⇔  drawAt <= now + horizon
            const endCutoff = new Date(Date.now() + offsetMs + horizon);

            const candidates = await prisma.trxWingoPeriod.findMany({
                where: {
                    resultNumber: null,
                    status: { in: ["ACTIVE", "ENDED"] },
                    endTime: { lte: endCutoff },
                },
                orderBy: { endTime: "asc" },
                take: 50,
            });

            if (candidates.length === 0) return;

            const withDrawAt = candidates.map((p) => ({
                period: p,
                drawAt: this.drawAtMs(p.endTime),
            }));

            let now = Date.now();
            let ready = withDrawAt.filter((x) => now >= x.drawAt);
            const upcoming = withDrawAt.filter((x) => x.drawAt > now);

            // Sleep until exact wall deadline when nothing is ready yet
            if (ready.length === 0 && upcoming.length > 0) {
                const nextDrawAt = Math.min(...upcoming.map((x) => x.drawAt));
                const wait = nextDrawAt - Date.now();
                const cap = maxSleepMs();
                if (wait > 0 && wait <= cap) {
                    logger.debug("TRX sleep-to-deadline", {
                        waitMs: wait,
                        nextDrawAt: new Date(nextDrawAt).toISOString(),
                        periods: upcoming.length,
                    });
                    await sleep(wait);
                } else if (wait > cap) {
                    // Too far out for this cycle — discovery tick will arm later
                    return;
                }
            }

            now = Date.now();
            ready = withDrawAt.filter((x) => now >= x.drawAt);
            if (ready.length === 0) return;

            // Target the earliest drawAt among ready periods — wait for tip
            // whose block timestamp is at/after that instant (not the prior 3s block).
            const minBlockTs = Math.min(...ready.map((x) => x.drawAt));

            let block: LatestBlock | undefined;
            try {
                // Wait past wall :54 so the chain can produce the :54 block.
                // Fetching at exactly drawAt almost always still sees the :51 tip
                // (Tron ~3s block time) — that is why history showed **:51**.
                const settleMs = Number(
                    process.env.TRX_DRAW_SETTLE_MS ?? "1800"
                );
                if (settleMs > 0) {
                    await sleep(Math.min(Math.max(settleMs, 0), 3500));
                }
                // Accept tip only if block time is at/after drawAt − 300ms
                // (:51 is ~3000ms early and will keep polling)
                block = await getTipAtOrAfter(minBlockTs - 300, {
                    maxWaitMs: Number(
                        process.env.TRX_TIP_WAIT_MAX_MS ?? "4500"
                    ),
                    pollMs: Number(process.env.TRX_TIP_POLL_MS ?? "400"),
                });
                const tipLag = minBlockTs - block.timestamp;
                logger.info("TRX tip-at-or-after", {
                    minBlockTs: new Date(minBlockTs).toISOString(),
                    tipTs: new Date(block.timestamp).toISOString(),
                    tipNumber: block.number,
                    tipLagMs: tipLag,
                    ok: tipLag <= 500,
                });
                if (tipLag > 2000) {
                    logger.warn(
                        "TRX tip still >2s before drawAt — Block time may show early second",
                        { tipLagMs: tipLag, blockNumber: block.number }
                    );
                }
            } catch (error) {
                logger.error(
                    "Cannot draw TRX periods: chain tip unavailable",
                    error
                );
                return;
            }

            for (const { period, drawAt } of ready) {
                // Final no-early guard (clock can only move forward here)
                if (Date.now() < drawAt) continue;
                await this.processPeriodResult(period.id, block);
            }
        } catch (error) {
            logger.error("Error processing draw-due periods:", error);
        }
    }

    /** @deprecated use processAllDrawDuePeriods — kept for callers */
    async processAllEndedPeriods(): Promise<void> {
        await this.processAllDrawDuePeriods();
    }

    isSpecialResult(number: number): boolean {
        return number === 0 || number === 5;
    }

    /** Extra color paid on special digits (alongside parity RED/GREEN). */
    getSecondaryColor(number: number): WingoResultColor | null {
        if (number === 0 || number === 5) return "VIOLET";
        return null;
    }
}
