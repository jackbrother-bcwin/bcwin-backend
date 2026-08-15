import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import type { User } from "@bcwin/db";
import { WebSocketManager } from "@bcwin/websocket";

const logger = new Logger("commission-calculator");

export class CommissionCalculator {
    // Calculate commission for a bet and distribute to upline
    static async calculateCommissionForBet(
        betId: string,
        betType: string,
        userId: string,
        betAmount: number,
        contractAmount: number
    ): Promise<void> {
        try {
            // Get user's upline chain (6 levels)
            const uplineChain = await this.getUplineChain(userId, 6);

            if (uplineChain.length === 0) {
                logger.debug(`User ${userId} has no upline, skipping commission calculation`);
                return;
            }

            logger.debug(
                `Calculating commission for bet ${betId} (${betType}) - User: ${userId}, Amount: ${contractAmount}, Upline levels: ${uplineChain.length}`
            );

            // Calculate commission for each level in the upline chain
            for (let layer = 1; layer <= uplineChain.length; layer++) {
                const uplineUser = uplineChain[layer - 1];

                // Get current VIP level of upline user
                const vipLevel = await this.getCurrentVipLevel(uplineUser.id);

                // Get commission rate for this VIP level and layer
                const commissionRate = await this.getCommissionRate(vipLevel, layer);

                if (commissionRate === 0) {
                    logger.debug(
                        `Skipping commission for layer ${layer} - VIP ${vipLevel} has 0% rate`
                    );
                    continue;
                }

                // Calculate commission amount
                const commissionAmount = contractAmount * (commissionRate / 100);

                if (commissionAmount > 0) {
                    // Record commission
                    await this.recordCommission({
                        userId: uplineUser.id,
                        fromUserId: userId,
                        layer,
                        userVipLevel: vipLevel,
                        commissionRate,
                        betAmount,
                        commissionAmount,
                        betType,
                        betId,
                        calculationDate: this.getDateAtMidnight(new Date()),
                    });

                    // Add to user balance
                    await this.addCommissionToBalance(uplineUser.id, commissionAmount);

                    logger.info(
                        `Commission: ${commissionAmount} (${commissionRate}%) -> User ${uplineUser.id} (Layer ${layer}, VIP ${vipLevel})`
                    );
                }
            }
        } catch (error) {
            logger.error(`Error calculating commission for bet ${betId}:`, error);
        }
    }

    // Daily commission aggregation (scheduled at 12:30 IST)
    static async aggregateDailyCommissions(date: Date): Promise<void> {
        try {
            logger.info(`Starting daily commission aggregation for ${date.toISOString()}`);

            const startOfDay = this.getDateAtMidnight(date);
            const endOfDay = new Date(startOfDay);
            endOfDay.setDate(endOfDay.getDate() + 1);

            // Get all users who have commissions for this date
            const usersWithCommissions = await prisma.commission.groupBy({
                by: ["userId"],
                where: {
                    calculationDate: {
                        gte: startOfDay,
                        lt: endOfDay,
                    },
                },
            });

            logger.info(
                `Found ${usersWithCommissions.length} users with commissions for ${date.toISOString()}`
            );

            for (const { userId } of usersWithCommissions) {
                await this.createDailyCommissionSummary(userId, startOfDay);
            }

            logger.info(`Completed daily commission aggregation for ${date.toISOString()}`);
        } catch (error) {
            logger.error("Error aggregating daily commissions:", error);
        }
    }

    // Get upline chain recursively
    private static async getUplineChain(userId: string, maxLevels: number): Promise<User[]> {
        const uplineChain: User[] = [];
        let currentUserId = userId;

        for (let level = 0; level < maxLevels; level++) {
            // Get current user
            const currentUser = await prisma.user.findUnique({
                where: { id: currentUserId },
                select: {
                    referredBy: true,
                },
            });

            if (!currentUser || !currentUser.referredBy) {
                // No more upline
                break;
            }

            // Find the upline user by referral code
            const uplineUser = await prisma.user.findUnique({
                where: { referralCode: currentUser.referredBy },
            });

            if (!uplineUser) {
                // Upline user not found (data inconsistency)
                logger.warn(
                    `Upline user with referral code ${currentUser.referredBy} not found`
                );
                break;
            }

            uplineChain.push(uplineUser);
            currentUserId = uplineUser.id;
        }

        return uplineChain;
    }

    // Get current VIP level for a user
    private static async getCurrentVipLevel(userId: string): Promise<number> {
        const vipLevel = await prisma.userVipLevel.findUnique({
            where: { userId },
            select: { currentLevel: true },
        });

        return vipLevel?.currentLevel ?? 0;
    }

    // Get commission rate from configuration
    private static async getCommissionRate(vipLevel: number, layer: number): Promise<number> {
        const config = await prisma.commissionRateConfig.findUnique({
            where: { vipLevel },
        });

        if (!config) {
            logger.warn(`Commission rate config not found for VIP level ${vipLevel}`);
            return 0;
        }

        // Map layer to the correct field
        const layerField = `layer${layer}` as keyof typeof config;
        return config[layerField] as number;
    }

    // Record commission in database
    private static async recordCommission(data: {
        userId: string;
        fromUserId: string;
        layer: number;
        userVipLevel: number;
        commissionRate: number;
        betAmount: number;
        commissionAmount: number;
        betType: string;
        betId: string;
        calculationDate: Date;
    }): Promise<void> {
        await prisma.commission.create({
            data,
        });
    }

    // Add commission to user balance
    private static async addCommissionToBalance(
        userId: string,
        commissionAmount: number
    ): Promise<void> {
        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: {
                balance: {
                    increment: commissionAmount,
                },
            },
            select: {
                balance: true,
            },
        });

        // Notify user via WebSocket
        WebSocketManager.publishToUser(userId, "account-balance", {
            balance: updatedUser.balance,
        });

        // WebSocketManager.publishToUser(userId, "commission-earned", {
        //     amount: commissionAmount,
        // });
    }

    // Create or update daily commission summary
    private static async createDailyCommissionSummary(
        userId: string,
        date: Date
    ): Promise<void> {
        try {
            const startOfDay = this.getDateAtMidnight(date);
            const endOfDay = new Date(startOfDay);
            endOfDay.setDate(endOfDay.getDate() + 1);

            // Get all commissions for this user and date
            const commissions = await prisma.commission.findMany({
                where: {
                    userId,
                    calculationDate: {
                        gte: startOfDay,
                        lt: endOfDay,
                    },
                },
            });

            // Calculate layer-wise totals
            const layerTotals = {
                layer1: 0,
                layer2: 0,
                layer3: 0,
                layer4: 0,
                layer5: 0,
                layer6: 0,
            };

            let totalCommission = 0;

            for (const commission of commissions) {
                totalCommission += commission.commissionAmount;
                const layerKey = `layer${commission.layer}` as keyof typeof layerTotals;
                layerTotals[layerKey] += commission.commissionAmount;
            }

            // Upsert daily summary
            await prisma.dailyCommissionSummary.upsert({
                where: {
                    userId_date: {
                        userId,
                        date: startOfDay,
                    },
                },
                update: {
                    totalCommission,
                    layer1Commission: layerTotals.layer1,
                    layer2Commission: layerTotals.layer2,
                    layer3Commission: layerTotals.layer3,
                    layer4Commission: layerTotals.layer4,
                    layer5Commission: layerTotals.layer5,
                    layer6Commission: layerTotals.layer6,
                },
                create: {
                    userId,
                    date: startOfDay,
                    totalCommission,
                    layer1Commission: layerTotals.layer1,
                    layer2Commission: layerTotals.layer2,
                    layer3Commission: layerTotals.layer3,
                    layer4Commission: layerTotals.layer4,
                    layer5Commission: layerTotals.layer5,
                    layer6Commission: layerTotals.layer6,
                },
            });

            logger.info(
                `Created daily commission summary for user ${userId} on ${date.toISOString()}: Total ${totalCommission}`
            );
        } catch (error) {
            logger.error(
                `Error creating daily commission summary for user ${userId}:`,
                error
            );
        }
    }

    // Helper: Get date at midnight (truncate time)
    private static getDateAtMidnight(date: Date): Date {
        const midnight = new Date(date);
        midnight.setHours(0, 0, 0, 0);
        return midnight;
    }
}
