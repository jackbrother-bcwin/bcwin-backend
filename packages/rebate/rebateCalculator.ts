import { prisma, type RebateGameCategory, type User } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { WebSocketManager } from "@bcwin/websocket";
import { Cache, CacheKey } from "@bcwin/cache";
import { mapGameToRebateCategory } from "./gameCategory";

const logger = new Logger("rebate-calculator");

export type CalculateTeamRebateOpts = {
    bettorId: string;
    betAmount: number;
    game: string;
    betId?: string;
    /** Override category (e.g. Inout catalog category already resolved) */
    gameCategory?: RebateGameCategory;
    /** Raw Inout category string for mapping */
    inoutCategory?: string | null;
};

/**
 * Independent multi-level team rebate (NOT commission).
 * Uplines L1–L6 earn unsettled rebate using RebateRateConfig[vip][category][layer].
 */
export class RebateCalculator {
    /**
     * @deprecated Prefer calculateTeamRebateForBet — kept as alias for call-site compatibility
     */
    static async calculateRebateForBet(
        userId: string,
        betAmount: number,
        game: string,
        opts?: { betId?: string; inoutCategory?: string | null; gameCategory?: RebateGameCategory }
    ): Promise<void> {
        return this.calculateTeamRebateForBet({
            bettorId: userId,
            betAmount,
            game,
            betId: opts?.betId,
            inoutCategory: opts?.inoutCategory,
            gameCategory: opts?.gameCategory,
        });
    }

    static async calculateTeamRebateForBet(
        opts: CalculateTeamRebateOpts
    ): Promise<void> {
        const { bettorId, betAmount, game, betId } = opts;
        try {
            if (!bettorId || betAmount <= 0) return;

            const bettor = await prisma.user.findUnique({
                where: { id: bettorId },
                select: { id: true, isDemo: true },
            });
            if (!bettor || bettor.isDemo) {
                return;
            }

            const category =
                opts.gameCategory ??
                mapGameToRebateCategory(game, opts.inoutCategory);

            const uplineChain = await this.getUplineChain(bettorId, 6);
            if (uplineChain.length === 0) {
                logger.debug(
                    `No upline for bettor ${bettorId}, skip team rebate`
                );
                return;
            }

            for (let layer = 1; layer <= uplineChain.length; layer++) {
                const upline = uplineChain[layer - 1]!;
                if (upline.isDemo) continue;

                const vipLevel = await this.getCurrentVipLevel(upline.id);
                const rate = await this.getRebateRate(
                    vipLevel,
                    category,
                    layer
                );
                if (rate <= 0) continue;

                const amount = betAmount * (rate / 100);
                if (amount <= 0) continue;

                await prisma.rebate.create({
                    data: {
                        userId: upline.id,
                        fromUserId: bettorId,
                        amount,
                        game: String(game).toUpperCase(),
                        gameCategory: category,
                        layer,
                        receiverVip: vipLevel,
                        rate,
                        betAmount,
                        betId: betId ?? null,
                        settled: false,
                    },
                });

                logger.debug(
                    `Team rebate ${amount.toFixed(4)} (${rate}% L${layer} VIP${vipLevel} ${category}) → ${upline.id} from bettor ${bettorId}`
                );
            }
        } catch (error) {
            logger.error(
                `Error calculating team rebate for bettor ${opts.bettorId}:`,
                error
            );
        }
    }

    /**
     * Settle all unsettled rebates — credit receivers' balances.
     * Independent of commission (which credits immediately).
     */
    static async settleAllUnsettledRebates(): Promise<void> {
        try {
            logger.info("Starting to settle all unsettled rebates...");

            const unsettledRebates = await prisma.rebate.findMany({
                where: { settled: false },
                orderBy: { userId: "asc" },
            });

            if (unsettledRebates.length === 0) {
                logger.info("No unsettled rebates found");
                return;
            }

            const rebatesByUser = new Map<string, typeof unsettledRebates>();
            for (const rebate of unsettledRebates) {
                if (!rebatesByUser.has(rebate.userId)) {
                    rebatesByUser.set(rebate.userId, []);
                }
                rebatesByUser.get(rebate.userId)!.push(rebate);
            }

            let totalSettled = 0;
            let totalAmount = 0;

            for (const [userId, userRebates] of rebatesByUser) {
                try {
                    const userTotalRebate = userRebates.reduce(
                        (sum, rebate) => sum + rebate.amount,
                        0
                    );
                    const rebateIds = userRebates.map((r) => r.id);

                    await prisma.$transaction(async (tx) => {
                        const updatedUser = await tx.user.update({
                            where: { id: userId },
                            data: {
                                balance: { increment: userTotalRebate },
                            },
                            select: { balance: true },
                        });

                        await tx.rebate.updateMany({
                            where: { id: { in: rebateIds } },
                            data: { settled: true },
                        });

                        WebSocketManager.publishToUser(
                            userId,
                            "account-balance",
                            { balance: updatedUser.balance }
                        );
                    });

                    await Cache.del(CacheKey.adminUserStats(userId)).catch(
                        (error) =>
                            logger.warn(
                                `Failed to clear admin user stats cache for ${userId}: ${String(error)}`
                            )
                    );

                    totalSettled += userRebates.length;
                    totalAmount += userTotalRebate;
                } catch (error) {
                    logger.error(
                        `Error settling rebates for user ${userId}:`,
                        error
                    );
                }
            }

            logger.info(
                `Completed rebate settlement: ${totalSettled} rebates, total ${totalAmount}`
            );
            if (totalSettled > 0) {
                await Cache.del(CacheKey.adminDashboardEarnings).catch(
                    (error) =>
                        logger.warn(
                            `Failed to clear admin dashboard earnings cache: ${String(error)}`
                        )
                );
            }
        } catch (error) {
            logger.error("Error settling unsettled rebates:", error);
        }
    }

    private static async getUplineChain(
        userId: string,
        maxLevels: number
    ): Promise<User[]> {
        const uplineChain: User[] = [];
        let currentUserId = userId;

        for (let level = 0; level < maxLevels; level++) {
            const currentUser = await prisma.user.findUnique({
                where: { id: currentUserId },
                select: { referredBy: true },
            });

            if (!currentUser?.referredBy) break;

            const uplineUser = await prisma.user.findUnique({
                where: { referralCode: currentUser.referredBy },
            });

            if (!uplineUser) {
                logger.warn(
                    `Upline with referral code ${currentUser.referredBy} not found`
                );
                break;
            }

            uplineChain.push(uplineUser);
            currentUserId = uplineUser.id;
        }

        return uplineChain;
    }

    /**
     * Agency rebate ladder (ADR-0012) — NOT XP VIP / currentLevel.
     * Keys RebateRateConfig.vipLevel.
     */
    private static async getCurrentVipLevel(userId: string): Promise<number> {
        const vip = await prisma.userVipLevel.findUnique({
            where: { userId },
            select: { rebateLevel: true },
        });
        return vip?.rebateLevel ?? 0;
    }

    private static async getRebateRate(
        vipLevel: number,
        category: RebateGameCategory,
        layer: number
    ): Promise<number> {
        const config = await prisma.rebateRateConfig.findUnique({
            where: {
                vipLevel_category: { vipLevel, category },
            },
        });

        if (!config) {
            logger.warn(
                `RebateRateConfig missing VIP ${vipLevel} ${category}`
            );
            return 0;
        }

        const key = `layer${layer}` as keyof typeof config;
        const val = config[key];
        return typeof val === "number" ? val : 0;
    }
}
