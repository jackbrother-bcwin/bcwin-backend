import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { WebSocketManager } from "@bcwin/websocket";
import type { K3Period } from "@bcwin/db";
import { generatePeriodNumber, calculatePeriodTimes } from "../utils";

const logger = new Logger("k3-period-manager");

export class PeriodManager {
    async createPeriodsForAllDurations(): Promise<void> {
        const durations = [30, 60, 180, 300];

        for (const duration of durations) {
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

    async createPeriodIfNeeded(
        durationSeconds: number
    ): Promise<K3Period | null> {
        const { startTime, endTime } = calculatePeriodTimes(durationSeconds);

        const periodNumber = generatePeriodNumber(durationSeconds);

        // Check if period already exists by periodNumber + durationSeconds
        const existingPeriod = await prisma.k3Period.findFirst({
            where: {
                periodNumber,
                durationSeconds,
            },
        });

        if (existingPeriod) {
            // If it was wrongly left ENDED but still in-window, re-activate
            const now = Date.now();
            if (
                existingPeriod.status !== "ACTIVE" &&
                existingPeriod.startTime.getTime() <= now &&
                existingPeriod.endTime.getTime() > now &&
                existingPeriod.dice1 == null
            ) {
                return await prisma.k3Period.update({
                    where: { id: existingPeriod.id },
                    data: { status: "ACTIVE" },
                });
            }
            return existingPeriod;
        }

        try {
            const newPeriod = await prisma.k3Period.create({
                data: {
                    periodNumber,
                    durationSeconds,
                    startTime,
                    endTime,
                    status: "ACTIVE",
                },
            });

            WebSocketManager.publishToTopic("k3-period-creation", {
                periodId: newPeriod.id,
                periodNumber,
                durationSeconds,
                startTime,
                endTime,
                status: "ACTIVE",
            });

            logger.debug("Created new K3 period", {
                periodId: newPeriod.id,
                periodNumber,
                durationSeconds,
            });
            return newPeriod;
        } catch (error) {
            // Unique race under 1s ticks — another worker created it
            logger.debug(
                `K3 period create race for duration ${durationSeconds}: ${String(error)}`
            );
            return await prisma.k3Period.findFirst({
                where: { periodNumber, durationSeconds },
            });
        }
    }

    async endActivePeriods(): Promise<void> {
        const now = new Date();

        try {
            const result = await prisma.k3Period.updateMany({
                where: {
                    status: "ACTIVE",
                    endTime: {
                        lte: now,
                    },
                },
                data: { status: "ENDED" },
            });

            if (result.count > 0) {
                logger.debug("Ended K3 periods", { count: result.count });
            }
        } catch (error) {
            logger.error("Error ending active K3 periods:", error);
        }
    }

    /** Live period: ACTIVE and still inside its time window */
    async getCurrentPeriod(durationSeconds: number): Promise<K3Period | null> {
        const now = new Date();
        return await prisma.k3Period.findFirst({
            where: {
                durationSeconds,
                status: "ACTIVE",
                startTime: { lte: now },
                endTime: { gt: now },
            },
            orderBy: { startTime: "desc" },
        });
    }

    async getEndedPeriods(): Promise<K3Period[]> {
        return await prisma.k3Period.findMany({
            where: {
                status: "ENDED",
            },
            orderBy: { endTime: "asc" },
        });
    }

    async updatePeriodToResolved(periodId: string): Promise<void> {
        await prisma.k3Period.update({
            where: { id: periodId },
            data: { status: "RESOLVED" },
        });
    }
}
