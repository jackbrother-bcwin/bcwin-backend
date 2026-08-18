import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { WebSocketManager } from "@bcwin/websocket";
import type { WingoPeriod } from "@bcwin/db";
import {
    generatePeriodNumber,
    calculatePeriodTimes,
    betLockSeconds,
} from "../utils";

const logger = new Logger("wingo-period-manager");

export const WINGO_DURATIONS = [30, 60, 180, 300] as const;

function toIso(d: Date): string {
    return d instanceof Date ? d.toISOString() : String(d);
}

export class PeriodManager {
    async createPeriodsForAllDurations(): Promise<void> {
        for (const duration of WINGO_DURATIONS) {
            try {
                await this.createPeriodIfNeeded(duration);
            } catch (error) {
                logger.error(
                    `Error creating period for duration ${duration}:`,
                    error
                );
            }
        }
    }

    /**
     * Insert the IST slot that contains `at` (default now).
     * Does not announce if the slot has not started yet (pre-create).
     */
    async createPeriodIfNeeded(
        durationSeconds: number,
        at: Date = new Date(),
        opts?: { announce?: boolean }
    ): Promise<WingoPeriod | null> {
        const { startTime, endTime } = calculatePeriodTimes(
            durationSeconds,
            at
        );
        const periodNumber = generatePeriodNumber(durationSeconds, at);

        const existingPeriod = await prisma.wingoPeriod.findFirst({
            where: {
                periodNumber,
                durationSeconds,
            },
        });

        if (existingPeriod) {
            return existingPeriod;
        }

        try {
            const newPeriod = await prisma.wingoPeriod.create({
                data: {
                    periodNumber,
                    durationSeconds,
                    startTime,
                    endTime,
                    status: "ACTIVE",
                },
            });

            const started = startTime.getTime() <= Date.now();
            if (opts?.announce !== false && started) {
                this.announcePeriod(newPeriod);
            }

            logger.debug("Created period", {
                periodId: newPeriod.id,
                periodNumber,
                durationSeconds,
                startTime: toIso(startTime),
                announced: opts?.announce !== false && started,
            });
            return newPeriod;
        } catch (error) {
            logger.error(
                `Failed to create period for duration ${durationSeconds}:`,
                error
            );
            return null;
        }
    }

    /** Next IST slot after `fromEnd` (current period's endTime). */
    async ensureNextPeriod(
        durationSeconds: number,
        fromEnd: Date
    ): Promise<WingoPeriod | null> {
        return this.createPeriodIfNeeded(durationSeconds, fromEnd, {
            announce: false,
        });
    }

    announcePeriod(period: WingoPeriod): void {
        WebSocketManager.publishToTopic("wingo-period-creation", {
            periodId: period.id,
            periodNumber: period.periodNumber,
            durationSeconds: period.durationSeconds,
            startTime: toIso(period.startTime),
            endTime: toIso(period.endTime),
            status: "ACTIVE",
        });
    }

    /** ACTIVE, already started, not yet ended. */
    async getLivePeriod(
        durationSeconds: number,
        now: Date = new Date()
    ): Promise<WingoPeriod | null> {
        return prisma.wingoPeriod.findFirst({
            where: {
                durationSeconds,
                status: "ACTIVE",
                startTime: { lte: now },
                endTime: { gt: now },
            },
            orderBy: { startTime: "desc" },
        });
    }

    isInLockWindow(period: WingoPeriod, now: Date = new Date()): boolean {
        const lockMs = betLockSeconds(period.durationSeconds) * 1000;
        return now.getTime() >= period.endTime.getTime() - lockMs;
    }

    async endExpiredPeriods(now: Date = new Date()): Promise<WingoPeriod[]> {
        const expired = await prisma.wingoPeriod.findMany({
            where: {
                status: "ACTIVE",
                endTime: { lte: now },
            },
        });
        const ended: WingoPeriod[] = [];
        for (const period of expired) {
            const updated = await prisma.wingoPeriod.update({
                where: { id: period.id },
                data: { status: "ENDED" },
            });
            ended.push(updated);
        }
        return ended;
    }

    async endActivePeriods(): Promise<void> {
        await this.endExpiredPeriods();
    }

    async getCurrentPeriod(
        durationSeconds: number
    ): Promise<WingoPeriod | null> {
        return this.getLivePeriod(durationSeconds);
    }

    async getEndedPeriods(): Promise<WingoPeriod[]> {
        return prisma.wingoPeriod.findMany({
            where: { status: "ENDED" },
            orderBy: { endTime: "asc" },
        });
    }

    async updatePeriodToResolved(periodId: string): Promise<void> {
        await prisma.wingoPeriod.update({
            where: { id: periodId },
            data: { status: "RESOLVED" },
        });
    }
}
