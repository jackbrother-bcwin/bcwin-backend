import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { WebSocketManager } from "@bcwin/websocket";
import type { WingoPeriod } from "@bcwin/db";
import { generatePeriodNumber, calculatePeriodTimes } from "../utils";

const logger = new Logger("wingo-period-manager");

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
    ): Promise<WingoPeriod | null> {
        const { startTime, endTime } = calculatePeriodTimes(durationSeconds);

        const periodNumber = generatePeriodNumber(durationSeconds);

        // Check if period already exists by periodNumber + durationSeconds
        // Period numbers are unique per game duration
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

            WebSocketManager.publishToTopic("wingo-period-creation", {
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
            const periodsToEnd = await prisma.wingoPeriod.findMany({
                where: {
                    status: "ACTIVE",
                    endTime: {
                        lte: now,
                    },
                },
            });

            for (const period of periodsToEnd) {
                await prisma.wingoPeriod.update({
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
    ): Promise<WingoPeriod | null> {
        return await prisma.wingoPeriod.findFirst({
            where: {
                durationSeconds,
                status: "ACTIVE",
            },
            orderBy: { startTime: "desc" },
        });
    }

    async getEndedPeriods(): Promise<WingoPeriod[]> {
        return await prisma.wingoPeriod.findMany({
            where: {
                status: "ENDED",
            },
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
