import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { WebSocketManager } from "@bcwin/websocket";
import type { FiveDPeriod } from "@bcwin/db";
import { generatePeriodNumber, calculatePeriodTimes } from "../utils";

const logger = new Logger("5d-period-manager");

export class FiveDPeriodManager {
    async createPeriodsForAllDurations(): Promise<void> {
        const durations = [30, 60, 180, 300];

        for (const duration of durations) {
            try {
                await this.createPeriodIfNeeded(duration);
            } catch (error) {
                logger.error(
                    `Error creating 5D period for duration ${duration}:`,
                    error
                );
            }
        }
    }

    async createPeriodIfNeeded(
        durationSeconds: number
    ): Promise<FiveDPeriod | null> {
        const { startTime, endTime } = calculatePeriodTimes(durationSeconds);
        const periodNumber = generatePeriodNumber(durationSeconds);

        const existingPeriod = await prisma.fiveDPeriod.findFirst({
            where: {
                periodNumber,
                durationSeconds,
            },
        });

        if (existingPeriod) {
            const now = Date.now();
            if (
                existingPeriod.status !== "ACTIVE" &&
                existingPeriod.startTime.getTime() <= now &&
                existingPeriod.endTime.getTime() > now &&
                existingPeriod.resultNumber == null
            ) {
                return await prisma.fiveDPeriod.update({
                    where: { id: existingPeriod.id },
                    data: { status: "ACTIVE" },
                });
            }
            return existingPeriod;
        }

        try {
            const newPeriod = await prisma.fiveDPeriod.create({
                data: {
                    periodNumber,
                    durationSeconds,
                    startTime,
                    endTime,
                    status: "ACTIVE",
                },
            });

            WebSocketManager.publishToTopic("5d-period-creation", {
                periodId: newPeriod.id,
                periodNumber,
                durationSeconds,
                startTime: startTime,
                endTime: endTime,
                status: "ACTIVE",
            });

            logger.debug("Created new 5D period", {
                periodId: newPeriod.id,
                periodNumber,
                durationSeconds,
            });
            return newPeriod;
        } catch (error) {
            logger.debug(
                `5D period create race for duration ${durationSeconds}: ${String(error)}`
            );
            return await prisma.fiveDPeriod.findFirst({
                where: { periodNumber, durationSeconds },
            });
        }
    }

    async endActivePeriods(): Promise<void> {
        const now = new Date();

        try {
            const result = await prisma.fiveDPeriod.updateMany({
                where: {
                    status: "ACTIVE",
                    endTime: { lte: now },
                },
                data: { status: "ENDED" },
            });

            if (result.count > 0) {
                logger.debug("Ended 5D periods", { count: result.count });
            }
        } catch (error) {
            logger.error("Error ending active 5D periods:", error);
        }
    }

    async getCurrentPeriod(
        durationSeconds: number
    ): Promise<FiveDPeriod | null> {
        const now = new Date();
        return await prisma.fiveDPeriod.findFirst({
            where: {
                durationSeconds,
                status: "ACTIVE",
                startTime: { lte: now },
                endTime: { gt: now },
            },
            orderBy: { startTime: "desc" },
        });
    }

    async getEndedPeriods(): Promise<FiveDPeriod[]> {
        return await prisma.fiveDPeriod.findMany({
            where: { status: "ENDED" },
            orderBy: { endTime: "asc" },
        });
    }

    async getPeriodsWithResults(): Promise<FiveDPeriod[]> {
        return await prisma.fiveDPeriod.findMany({
            where: {
                status: "ENDED",
                resultNumber: { not: null },
            },
            orderBy: { endTime: "asc" },
        });
    }

    async updatePeriodToResolved(periodId: string): Promise<void> {
        await prisma.fiveDPeriod.update({
            where: { id: periodId },
            data: { status: "RESOLVED" },
        });
        logger.debug("Updated 5D period to resolved", { periodId });
    }

    async getPeriodById(periodId: string): Promise<FiveDPeriod | null> {
        return await prisma.fiveDPeriod.findUnique({
            where: { id: periodId },
        });
    }

    async getRecentPeriods(
        durationSeconds?: number,
        limit: number = 10
    ): Promise<FiveDPeriod[]> {
        const whereClause = durationSeconds ? { durationSeconds } : {};
        return await prisma.fiveDPeriod.findMany({
            where: whereClause,
            orderBy: { startTime: "desc" },
            take: limit,
        });
    }

    async getActivePeriods(): Promise<FiveDPeriod[]> {
        return await prisma.fiveDPeriod.findMany({
            where: { status: "ACTIVE" },
            orderBy: { durationSeconds: "asc" },
        });
    }
}
