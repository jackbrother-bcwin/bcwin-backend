import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { WebSocketManager } from "@bcwin/websocket";
import type { TrxWingoPeriod } from "@bcwin/db";
import { generatePeriodNumber, calculatePeriodTimes } from "../utils";

const logger = new Logger("trx-wingo-period-manager");

export class PeriodManager {
    async createPeriodsForAllDurations(): Promise<void> {
        // const durations = [30, 60, 180, 300]; // 30s, 1m, 3m, 5m
        const durations = [60, 180, 300, 600]; // 1m, 3m, 5m, 10m

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
    ): Promise<TrxWingoPeriod | null> {
        const { startTime, endTime } = calculatePeriodTimes(durationSeconds);

        const periodNumber = generatePeriodNumber(durationSeconds);

        // Check if period already exists by periodNumber + durationSeconds
        // Period numbers are unique per game duration
        const existingPeriod = await prisma.trxWingoPeriod.findFirst({
            where: {
                periodNumber,
                durationSeconds,
            },
        });

        if (existingPeriod) {
            return existingPeriod;
        }

        try {
            const newPeriod = await prisma.trxWingoPeriod.create({
                data: {
                    periodNumber,
                    durationSeconds,
                    startTime,
                    endTime,
                    status: "ACTIVE",
                },
            });

            WebSocketManager.publishToTopic("trx-wingo-period-creation", {
                periodId: newPeriod.id,
                periodNumber,
                durationSeconds,
                startTime,
                endTime,
                status: "ACTIVE",
            });

            logger.debug("Created new period", {
                periodId: newPeriod.id,
                periodNumber,
                durationSeconds,
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

    async endActivePeriods(): Promise<void> {
        const now = new Date();

        try {
            const periodsToEnd = await prisma.trxWingoPeriod.findMany({
                where: {
                    status: "ACTIVE",
                    endTime: {
                        lte: now,
                    },
                },
            });

            for (const period of periodsToEnd) {
                await prisma.trxWingoPeriod.update({
                    where: { id: period.id },
                    data: { status: "ENDED" },
                });

                logger.debug("Ended period", {
                    periodNumber: period.periodNumber,
                    periodId: period.id,
                });
            }
        } catch (error) {
            logger.error("Error ending active periods:", error);
        }
    }

    async getCurrentPeriod(
        durationSeconds: number
    ): Promise<TrxWingoPeriod | null> {
        const now = new Date();
        return await prisma.trxWingoPeriod.findFirst({
            where: {
                durationSeconds,
                status: "ACTIVE",
                startTime: { lte: now },
                endTime: { gt: now },
            },
            orderBy: { startTime: "desc" },
        });
    }

    async getEndedPeriods(): Promise<TrxWingoPeriod[]> {
        return await prisma.trxWingoPeriod.findMany({
            where: {
                status: "ENDED",
            },
            orderBy: { endTime: "asc" },
        });
    }

    async updatePeriodToResolved(periodId: string): Promise<void> {
        await prisma.trxWingoPeriod.update({
            where: { id: periodId },
            data: { status: "RESOLVED" },
        });
    }
}
