import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";

const logger = new Logger("vip-level-service");

interface TeamMetricsData {
    teamSize: number;
    teamBetting: number;
    teamDeposit: number;
}

export class VipLevelService {
    /**
     * XP VIP ladder: highest level where user.xp >= expRequired.
     * Used for rewards only (ADR-0012).
     */
    static async calculateXpVipLevel(userId: string): Promise<number> {
        try {
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { xp: true },
            });
            if (!user) return 0;

            const userXp = user.xp || 0;
            const vipRequirements = await prisma.vipLevelRequirement.findMany({
                orderBy: { level: "desc" },
            });

            for (const requirement of vipRequirements) {
                if (userXp >= requirement.expRequired) {
                    logger.debug(
                        `User ${userId} qualifies for XP VIP ${requirement.level} (${userXp} XP)`
                    );
                    return requirement.level;
                }
            }
            return 0;
        } catch (error) {
            logger.error(
                `Error calculating XP VIP for user ${userId}:`,
                error
            );
            return 0;
        }
    }

    /** @deprecated use calculateXpVipLevel */
    static async calculateUserVipLevel(userId: string): Promise<number> {
        return this.calculateXpVipLevel(userId);
    }

    /**
     * Rebate ladder: highest N where total L1–L6 team metrics meet AND of
     * teamSize, teamBetting, teamDeposit on VipLevelRequirement (ADR-0012).
     */
    static async calculateRebateLevelFromMetrics(
        metrics: TeamMetricsData
    ): Promise<number> {
        const requirements = await prisma.vipLevelRequirement.findMany({
            orderBy: { level: "desc" },
        });

        for (const req of requirements) {
            if (
                metrics.teamSize >= req.teamSize &&
                metrics.teamBetting >= req.teamBetting &&
                metrics.teamDeposit >= req.teamDeposit
            ) {
                return req.level;
            }
        }
        return 0;
    }

    /**
     * Full update: team metrics → sticky rebateLevel; XP → sticky currentLevel (XP VIP).
     */
    static async updateUserVipLevel(
        userId: string,
        opts?: { skipTeamMetrics?: boolean }
    ): Promise<{ xpLevel: number; rebateLevel: number }> {
        try {
            if (!opts?.skipTeamMetrics) {
                await this.calculateAndUpdateTeamMetrics(userId);
            }

            const metrics = await this.getTeamMetrics(userId);
            const qualifiedXp = await this.calculateXpVipLevel(userId);

            const existing = await prisma.userVipLevel.findUnique({
                where: { userId },
                select: { currentLevel: true, rebateLevel: true },
            });

            const oldXp = existing?.currentLevel ?? 0;
            const oldRebate = existing?.rebateLevel ?? 0;

            // XP VIP stays sticky. Rebate level is a one-day badge (ADR-0036)
            // written only by the 00:00 IST close job — do not restore lifetime.
            const xpLevel = Math.max(oldXp, qualifiedXp);
            const rebateLevel = oldRebate;

            await prisma.userVipLevel.upsert({
                where: { userId },
                update: {
                    currentLevel: xpLevel,
                    rebateLevel,
                    teamSize: metrics.teamSize,
                    teamBetting: metrics.teamBetting,
                    teamDeposit: metrics.teamDeposit,
                    lastCalculatedAt: new Date(),
                },
                create: {
                    userId,
                    currentLevel: xpLevel,
                    rebateLevel,
                    teamSize: metrics.teamSize,
                    teamBetting: metrics.teamBetting,
                    teamDeposit: metrics.teamDeposit,
                    lastCalculatedAt: new Date(),
                },
            });

            if (xpLevel !== oldXp) {
                logger.info(
                    `User ${userId} XP VIP changed: ${oldXp} -> ${xpLevel}`
                );
            }
            if (rebateLevel !== oldRebate) {
                logger.info(
                    `User ${userId} rebate level changed: ${oldRebate} -> ${rebateLevel}`
                );
            }

            return { xpLevel, rebateLevel };
        } catch (error) {
            logger.error(`Error updating VIP level for user ${userId}:`, error);
            throw error;
        }
    }

    /**
     * Fast XP→XP VIP sticky sync after betting (no team metrics).
     * Does not change rebateLevel.
     */
    static async syncLevelFromXp(userId: string): Promise<number> {
        const qualifiedXp = await this.calculateXpVipLevel(userId);
        const existing = await prisma.userVipLevel.findUnique({
            where: { userId },
            select: { currentLevel: true, rebateLevel: true },
        });
        const oldXp = existing?.currentLevel ?? 0;
        const xpLevel = Math.max(oldXp, qualifiedXp);
        const rebateLevel = existing?.rebateLevel ?? 0;

        await prisma.userVipLevel.upsert({
            where: { userId },
            update: {
                currentLevel: xpLevel,
                lastCalculatedAt: new Date(),
            },
            create: {
                userId,
                currentLevel: xpLevel,
                rebateLevel,
                teamSize: 0,
                teamBetting: 0,
                teamDeposit: 0,
                lastCalculatedAt: new Date(),
            },
        });

        if (xpLevel !== oldXp) {
            logger.info(
                `User ${userId} XP VIP changed (bet sync): ${oldXp} -> ${xpLevel}`
            );
        }
        return xpLevel;
    }

    /**
     * Update VIP / rebate levels for all users (scheduled daily).
     */
    static async updateAllUserVipLevels(): Promise<void> {
        logger.info(
            "Starting dual-track VIP/rebate level calculation for all users..."
        );

        const batchSize = 50;
        let skip = 0;
        let totalUsers = 0;
        let updatedUsers = 0;

        try {
            while (true) {
                const users = await prisma.user.findMany({
                    skip,
                    take: batchSize,
                    where: { isBanned: false },
                    select: { id: true },
                });

                if (users.length === 0) break;

                totalUsers += users.length;

                for (const user of users) {
                    try {
                        await this.updateUserVipLevel(user.id);
                        updatedUsers++;
                    } catch (error) {
                        logger.error(
                            `Failed to update VIP level for user ${user.id}:`,
                            error
                        );
                    }
                }

                skip += batchSize;

                logger.info(
                    `Processed ${totalUsers} users, updated ${updatedUsers} successfully`
                );
            }

            logger.info(
                `VIP/rebate level calculation completed. Total: ${totalUsers}, Updated: ${updatedUsers}`
            );
        } catch (error) {
            logger.error("Error in updateAllUserVipLevels:", error);
            throw error;
        }
    }

    /**
     * Backfill rebateLevel from TeamMetrics (sticky from 0). One-shot ops.
     */
    static async backfillRebateLevels(): Promise<number> {
        const rows = await prisma.userVipLevel.findMany({
            select: { userId: true, rebateLevel: true },
        });
        let n = 0;
        for (const row of rows) {
            await this.calculateAndUpdateTeamMetrics(row.userId);
            const metrics = await this.getTeamMetrics(row.userId);
            const qualified =
                await this.calculateRebateLevelFromMetrics(metrics);
            const rebateLevel = Math.max(row.rebateLevel, qualified);
            if (rebateLevel !== row.rebateLevel) {
                await prisma.userVipLevel.update({
                    where: { userId: row.userId },
                    data: {
                        rebateLevel,
                        teamSize: metrics.teamSize,
                        teamBetting: metrics.teamBetting,
                        teamDeposit: metrics.teamDeposit,
                        lastCalculatedAt: new Date(),
                    },
                });
                n++;
            } else {
                await prisma.userVipLevel.update({
                    where: { userId: row.userId },
                    data: {
                        teamSize: metrics.teamSize,
                        teamBetting: metrics.teamBetting,
                        teamDeposit: metrics.teamDeposit,
                    },
                });
            }
        }
        logger.info(`backfillRebateLevels: raised ${n} rows`);
        return n;
    }

    /**
     * Recompute amount + receiverVip on unsettled rebates using current rebateLevel.
     */
    static async recomputeUnsettledRebateReceiverLevels(): Promise<number> {
        const unsettled = await prisma.rebate.findMany({
            where: { settled: false },
            select: {
                id: true,
                userId: true,
                betAmount: true,
                layer: true,
                gameCategory: true,
            },
        });

        let updated = 0;
        for (const row of unsettled) {
            const vip = await prisma.userVipLevel.findUnique({
                where: { userId: row.userId },
                select: { rebateLevel: true },
            });
            const rebateLevel = vip?.rebateLevel ?? 0;
            const category = row.gameCategory ?? "LOTTERY";
            const config = await prisma.rebateRateConfig.findUnique({
                where: {
                    vipLevel_category: {
                        vipLevel: rebateLevel,
                        category,
                    },
                },
            });
            if (!config) continue;

            const layerKey = `layer${row.layer}` as
                | "layer1"
                | "layer2"
                | "layer3"
                | "layer4"
                | "layer5"
                | "layer6";
            const rate = Number(config[layerKey] ?? 0);
            const amount = row.betAmount * (rate / 100);

            await prisma.rebate.update({
                where: { id: row.id },
                data: {
                    receiverVip: rebateLevel,
                    rate,
                    amount,
                },
            });
            updated++;
        }
        logger.info(
            `recomputeUnsettledRebateReceiverLevels: updated ${updated} rows`
        );
        return updated;
    }

    private static async getTeamMetrics(
        userId: string
    ): Promise<TeamMetricsData> {
        const teamMetrics = await prisma.teamMetrics.findUnique({
            where: { userId },
            select: {
                totalTeamSize: true,
                totalTeamBetting: true,
                totalTeamDeposit: true,
            },
        });

        return {
            teamSize: teamMetrics?.totalTeamSize || 0,
            teamBetting: teamMetrics?.totalTeamBetting || 0,
            teamDeposit: teamMetrics?.totalTeamDeposit || 0,
        };
    }

    private static async calculateAndUpdateTeamMetrics(
        userId: string
    ): Promise<void> {
        const teamMembers = await this.getTeamMembers(userId);

        const directTeamMembers = teamMembers.filter((m) => m.layer === 1);
        const directTeamSize = directTeamMembers.length;
        const totalTeamSize = teamMembers.length;

        const directMemberIds = directTeamMembers.map((m) => m.userId);
        const allMemberIds = teamMembers.map((m) => m.userId);

        const [directBetting, directDeposits, totalBetting, totalDeposits] =
            await Promise.all([
                this.calculateTotalBetting(directMemberIds),
                this.calculateTotalDeposits(directMemberIds),
                this.calculateTotalBetting(allMemberIds),
                this.calculateTotalDeposits(allMemberIds),
            ]);

        await prisma.teamMetrics.upsert({
            where: { userId },
            update: {
                directTeamSize,
                directTeamBetting: directBetting,
                directTeamDeposit: directDeposits,
                totalTeamSize,
                totalTeamBetting: totalBetting,
                totalTeamDeposit: totalDeposits,
                lastUpdated: new Date(),
            },
            create: {
                userId,
                directTeamSize,
                directTeamBetting: directBetting,
                directTeamDeposit: directDeposits,
                totalTeamSize,
                totalTeamBetting: totalBetting,
                totalTeamDeposit: totalDeposits,
                lastUpdated: new Date(),
            },
        });
    }

    private static async getTeamMembers(
        userId: string,
        maxLayers: number = 6
    ): Promise<Array<{ userId: string; layer: number }>> {
        const teamMembers: Array<{ userId: string; layer: number }> = [];
        let currentLayerUsers = [userId];

        for (let layer = 1; layer <= maxLayers; layer++) {
            if (currentLayerUsers.length === 0) break;

            const referralCodes = await prisma.user.findMany({
                where: { id: { in: currentLayerUsers } },
                select: { referralCode: true },
            });

            if (referralCodes.length === 0) break;

            const nextLayerUsers = await prisma.user.findMany({
                where: {
                    referredBy: {
                        in: referralCodes.map((u) => u.referralCode),
                    },
                },
                select: { id: true },
            });

            for (const user of nextLayerUsers) {
                teamMembers.push({ userId: user.id, layer });
            }

            currentLayerUsers = nextLayerUsers.map((u) => u.id);
        }

        return teamMembers;
    }

    private static async calculateTotalBetting(
        userIds: string[]
    ): Promise<number> {
        if (userIds.length === 0) return 0;

        const [wingoBets, fiveDBets, k3Bets, motoBets, trxWingoBets, inoutBets] =
            await Promise.all([
                prisma.wingoBet.aggregate({
                    where: { userId: { in: userIds } },
                    _sum: { betAmount: true },
                }),
                prisma.fiveDBet.aggregate({
                    where: { userId: { in: userIds } },
                    _sum: { betAmount: true },
                }),
                prisma.k3Bet.aggregate({
                    where: { userId: { in: userIds } },
                    _sum: { betAmount: true },
                }),
                prisma.motoBet.aggregate({
                    where: { userId: { in: userIds } },
                    _sum: { betAmount: true },
                }),
                prisma.trxWingoBet.aggregate({
                    where: { userId: { in: userIds } },
                    _sum: { betAmount: true },
                }),
                prisma.inoutBet.aggregate({
                    where: { userId: { in: userIds } },
                    _sum: { betAmount: true },
                }),
            ]);

        return (
            (wingoBets._sum.betAmount || 0) +
            (fiveDBets._sum.betAmount || 0) +
            (k3Bets._sum.betAmount || 0) +
            (motoBets._sum.betAmount || 0) +
            (trxWingoBets._sum.betAmount || 0) +
            (inoutBets._sum.betAmount || 0)
        );
    }

    private static async calculateTotalDeposits(
        userIds: string[]
    ): Promise<number> {
        if (userIds.length === 0) return 0;

        const deposits = await prisma.deposit.aggregate({
            where: {
                userId: { in: userIds },
                status: "SUCCESS",
            },
            _sum: { amount: true },
        });

        return deposits._sum.amount || 0;
    }
}
