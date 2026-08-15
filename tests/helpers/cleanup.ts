import { prisma } from "@bcwin/db";
import { Cache } from "@bcwin/cache";

/**
 * Delete all data owned by the given user IDs + tagged test periods/gifts.
 * Order respects FKs; cascades cover many child tables via User.
 */
export async function cleanupByUserIds(
    userIds: string[],
    tags?: {
        periodPrefix?: string;
        giftCodePrefix?: string;
        orderIdPrefix?: string;
        referralCodes?: string[];
    }
): Promise<void> {
    if (userIds.length === 0 && !tags?.periodPrefix) return;

    const periodPrefix = tags?.periodPrefix ?? "DT_";
    const giftPrefix = tags?.giftCodePrefix ?? "DTGIFT_";
    const orderPrefix = tags?.orderIdPrefix ?? "DT-";

    // Bet results → bets (per game)
    if (userIds.length > 0) {
        await prisma.wingoBetResult.deleteMany({
            where: { bet: { userId: { in: userIds } } },
        });
        await prisma.k3BetResult.deleteMany({
            where: { bet: { userId: { in: userIds } } },
        });
        await prisma.fiveDBetResult.deleteMany({
            where: { bet: { userId: { in: userIds } } },
        });
        await prisma.motoBetResult.deleteMany({
            where: { bet: { userId: { in: userIds } } },
        });
        await prisma.trxWingoBetResult.deleteMany({
            where: { bet: { userId: { in: userIds } } },
        });

        await prisma.wingoBet.deleteMany({
            where: { userId: { in: userIds } },
        });
        await prisma.k3Bet.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.fiveDBet.deleteMany({
            where: { userId: { in: userIds } },
        });
        await prisma.motoBet.deleteMany({
            where: { userId: { in: userIds } },
        });
        await prisma.trxWingoBet.deleteMany({
            where: { userId: { in: userIds } },
        });
        await prisma.inoutBet.deleteMany({
            where: { userId: { in: userIds } },
        });

        await prisma.commission.deleteMany({
            where: {
                OR: [
                    { userId: { in: userIds } },
                    { fromUserId: { in: userIds } },
                ],
            },
        });
        await prisma.dailyCommissionSummary.deleteMany({
            where: { userId: { in: userIds } },
        });
        await prisma.rebate.deleteMany({
            where: {
                OR: [
                    { userId: { in: userIds } },
                    { fromUserId: { in: userIds } },
                ],
            },
        });
        await prisma.selfRebate.deleteMany({
            where: { userId: { in: userIds } },
        });
        await prisma.activityBonus.deleteMany({
            where: { userId: { in: userIds } },
        });
        await prisma.deposit.deleteMany({
            where: { userId: { in: userIds } },
        });
        await prisma.withdraw.deleteMany({
            where: { userId: { in: userIds } },
        });
        await prisma.giftRedemption.deleteMany({
            where: { userId: { in: userIds } },
        });
        await prisma.adminBalanceUpdateTransaction.deleteMany({
            where: {
                OR: [
                    { userId: { in: userIds } },
                    { byUserId: { in: userIds } },
                ],
            },
        });
        await prisma.illegalBet.deleteMany({
            where: { userId: { in: userIds } },
        });
        await prisma.ipActivity.deleteMany({
            where: { userId: { in: userIds } },
        });
        await prisma.userQuery.deleteMany({
            where: { userId: { in: userIds } },
        });
        await prisma.salaryPayment.deleteMany({
            where: { userId: { in: userIds } },
        });
        await prisma.autoSalaryClaim.deleteMany({
            where: {
                OR: [
                    { userId: { in: userIds } },
                    { reviewedById: { in: userIds } },
                ],
            },
        });
        await prisma.vipRewardClaim.deleteMany({
            where: { userId: { in: userIds } },
        });
        await prisma.userWinStreak.deleteMany({
            where: { userId: { in: userIds } },
        });
        await prisma.spinWheel.deleteMany({
            where: { userId: { in: userIds } },
        });
        await prisma.teamMetrics.deleteMany({
            where: { userId: { in: userIds } },
        });
        await prisma.userVipLevel.deleteMany({
            where: { userId: { in: userIds } },
        });
        await prisma.bank.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.salaryRule.deleteMany({
            where: { userId: { in: userIds } },
        });

        // Clear auth cache keys
        await Promise.all(
            userIds.map((id) => Cache.del(`user:${id}`).catch(() => 0))
        );

        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }

    // Periods tagged for tests (no user FK)
    await prisma.wingoBetResult.deleteMany({
        where: { period: { periodNumber: { startsWith: periodPrefix } } },
    });
    await prisma.wingoBet.deleteMany({
        where: { period: { periodNumber: { startsWith: periodPrefix } } },
    });
    await prisma.wingoPeriod.deleteMany({
        where: { periodNumber: { startsWith: periodPrefix } },
    });

    await prisma.k3BetResult.deleteMany({
        where: { period: { periodNumber: { startsWith: periodPrefix } } },
    });
    await prisma.k3Bet.deleteMany({
        where: { period: { periodNumber: { startsWith: periodPrefix } } },
    });
    await prisma.k3Period.deleteMany({
        where: { periodNumber: { startsWith: periodPrefix } },
    });

    await prisma.fiveDBetResult.deleteMany({
        where: { period: { periodNumber: { startsWith: periodPrefix } } },
    });
    await prisma.fiveDBet.deleteMany({
        where: { period: { periodNumber: { startsWith: periodPrefix } } },
    });
    await prisma.fiveDPeriod.deleteMany({
        where: { periodNumber: { startsWith: periodPrefix } },
    });

    await prisma.motoBetResult.deleteMany({
        where: { period: { periodNumber: { startsWith: periodPrefix } } },
    });
    await prisma.motoBet.deleteMany({
        where: { period: { periodNumber: { startsWith: periodPrefix } } },
    });
    await prisma.motoPeriod.deleteMany({
        where: { periodNumber: { startsWith: periodPrefix } },
    });

    await prisma.trxWingoBetResult.deleteMany({
        where: { period: { periodNumber: { startsWith: periodPrefix } } },
    });
    await prisma.trxWingoBet.deleteMany({
        where: { period: { periodNumber: { startsWith: periodPrefix } } },
    });
    await prisma.trxWingoPeriod.deleteMany({
        where: { periodNumber: { startsWith: periodPrefix } },
    });

    await prisma.gift.deleteMany({
        where: { code: { startsWith: giftPrefix } },
    });

    await prisma.deposit.deleteMany({
        where: { orderId: { startsWith: orderPrefix } },
    });
    await prisma.withdraw.deleteMany({
        where: { orderId: { startsWith: orderPrefix } },
    });

    // OTPs used in register tests (mobile numbers we use are 9xxxxxxxxxx range)
    if (tags?.referralCodes?.length) {
        // no-op placeholder
    }
}

/** Cleanup by username prefix (e.g. dt_) — for leftover orphans. */
export async function cleanupByUsernamePrefix(prefix: string): Promise<void> {
    const users = await prisma.user.findMany({
        where: { username: { startsWith: prefix } },
        select: { id: true },
    });
    await cleanupByUserIds(users.map((u) => u.id), {
        periodPrefix: "DT_",
        giftCodePrefix: "DTGIFT_",
        orderIdPrefix: "DT-",
    });
}
