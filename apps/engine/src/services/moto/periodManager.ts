import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { WebSocketManager } from "@bcwin/websocket";
import type { MotoPeriod } from "@bcwin/db";
import { generatePeriodNumber, calculatePeriodTimes } from "../utils";

const logger = new Logger("moto-period-manager");

export class MotoPeriodManager {
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
    ): Promise<MotoPeriod | null> {
        const { startTime, endTime } = calculatePeriodTimes(durationSeconds);

        const periodNumber = generatePeriodNumber(durationSeconds);

        // Check if period already exists by periodNumber + durationSeconds
        // Period numbers are unique per game duration
        const existingPeriod = await prisma.motoPeriod.findFirst({
            where: {
                periodNumber,
                durationSeconds,
            },
        });

        if (existingPeriod) {
            return existingPeriod;
        }

        try {
            const newPeriod = await prisma.motoPeriod.create({
                data: {
                    periodNumber,
                    durationSeconds,
                    startTime,
                    endTime,
                    status: "ACTIVE",
                },
            });

            WebSocketManager.publishToTopic("moto-period-creation", {
                periodId: newPeriod.id,
                periodNumber,
                durationSeconds,
                startTime,
                endTime,
                status: "ACTIVE",
            });

            logger.debug("Created new moto period", {
                periodId: newPeriod.id,
                periodNumber,
                durationSeconds,
            });
            return newPeriod;
        } catch (error) {
            logger.error(
                `Failed to create moto period for duration ${durationSeconds}:`,
                error
            );
            return null;
        }
    }

    async endActivePeriods(): Promise<void> {
        const now = new Date();

        try {
            const periodsToEnd = await prisma.motoPeriod.findMany({
                where: {
                    status: "ACTIVE",
                    endTime: {
                        lte: now,
                    },
                },
            });

            for (const period of periodsToEnd) {
                await prisma.motoPeriod.update({
                    where: { id: period.id },
                    data: { status: "ENDED" },
                });

                logger.debug("Ended moto period", {
                    periodNumber: period.periodNumber,
                    periodId: period.id,
                });
            }
        } catch (error) {
            logger.error("Error ending active moto periods:", error);
        }
    }

    async getCurrentPeriod(
        durationSeconds: number
    ): Promise<MotoPeriod | null> {
        return await prisma.motoPeriod.findFirst({
            where: {
                durationSeconds,
                status: "ACTIVE",
            },
            orderBy: { startTime: "desc" },
        });
    }

    async getEndedPeriods(): Promise<MotoPeriod[]> {
        return await prisma.motoPeriod.findMany({
            where: {
                status: "ENDED",
            },
            orderBy: { endTime: "asc" },
        });
    }

    async updatePeriodToResolved(periodId: string): Promise<void> {
        await prisma.motoPeriod.update({
            where: { id: periodId },
            data: { status: "RESOLVED" },
        });
    }
}
