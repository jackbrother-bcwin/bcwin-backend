import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import type { User } from "@bcwin/db";

const logger = new Logger("team-metrics-calculator");

export class TeamMetricsCalculator {
    /**
     * Calculate and update team metrics for a user
     */
    static async calculateAndUpdateTeamMetrics(userId: string): Promise<void> {
        try {
            // Check if user is a demo user
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { isDemo: true },
            });

            if (user?.isDemo) {
                logger.debug(
                    `Skipping team metrics calculation for demo user ${userId}`
                );
                return;
            }

            // Get all team members
            const teamMembers = await this.getTeamMembers(userId);

            // Separate direct team (layer 1) from total team
            const directTeamMembers = teamMembers.filter((m) => m.layer === 1);
            const directTeamSize = directTeamMembers.length;
            const totalTeamSize = teamMembers.length;

            // Get member IDs for aggregation
            const directMemberIds = directTeamMembers.map((m) => m.user.id);
            const allMemberIds = teamMembers.map((m) => m.user.id);

            // Calculate direct team metrics
            const [directBetting, directDeposits] = await Promise.all([
                this.calculateTotalBetting(directMemberIds),
                this.calculateTotalDeposits(directMemberIds),
            ]);

            // Calculate total team metrics
            const [totalBetting, totalDeposits] = await Promise.all([
                this.calculateTotalBetting(allMemberIds),
                this.calculateTotalDeposits(allMemberIds),
            ]);

            // Update or create TeamMetrics
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

            logger.debug(
                `Updated team metrics for user ${userId}: Direct ${directTeamSize}, Total ${totalTeamSize}`
            );
        } catch (error) {
            logger.error(
                `Error calculating team metrics for user ${userId}:`,
                error
            );
            throw error;
        }
    }

    /**
     * Get team members recursively up to maxLayers
     */
    static async getTeamMembers(
        userId: string,
        maxLayers: number = 6
    ): Promise<Array<{ user: User; layer: number }>> {
        const teamMembers: Array<{ user: User; layer: number }> = [];
        let currentLayerUsers = [userId];

        for (let layer = 1; layer <= maxLayers; layer++) {
            if (currentLayerUsers.length === 0) break;

            // Get referral codes of current layer users
            const referralCodes = await prisma.user.findMany({
                where: { id: { in: currentLayerUsers } },
                select: { referralCode: true },
            });

            if (referralCodes.length === 0) break;

            // Get users who were referred by current layer users
            const nextLayerUsers = await prisma.user.findMany({
                where: {
                    referredBy: {
                        in: referralCodes.map((u) => u.referralCode),
                    },
                    isDemo: false,
                },
            });

            for (const user of nextLayerUsers) {
                teamMembers.push({ user, layer });
            }

            currentLayerUsers = nextLayerUsers.map((u) => u.id);
        }

        return teamMembers;
    }

    /**
     * Calculate total betting amount for given user IDs
     */
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
                    where: {
                        userId: { in: userIds },
                        isRolledback: false,
                    },
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

    /**
     * Calculate total successful deposits for given user IDs
     */
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

    /**
     * Bulk update team metrics for multiple users
     */
    static async bulkUpdateTeamMetrics(userIds: string[]): Promise<void> {
        logger.info(
            `Starting bulk team metrics update for ${userIds.length} users`
        );

        for (const userId of userIds) {
            try {
                await this.calculateAndUpdateTeamMetrics(userId);
            } catch (error) {
                logger.error(
                    `Failed to update metrics for user ${userId}:`,
                    error
                );
                // Continue with other users
            }
        }

        logger.info(`Completed bulk team metrics update`);
    }
}
