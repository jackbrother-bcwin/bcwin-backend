import { prisma } from "@bcwin/db";
import { REAL_USER_WHERE } from "@/lib/realUserFilter";

// Helper function to get team members recursively
export async function getTeamMembers(
    userId: string,
    maxLayers: number = 6
): Promise<Array<{ user: any; layer: number }>> {
    const teamMembers: Array<{ user: any; layer: number }> = [];
    let currentLayerUsers = [userId];

    for (let layer = 1; layer <= maxLayers; layer++) {
        if (currentLayerUsers.length === 0) break;

        const nextLayerUsers = await prisma.user.findMany({
            where: {
                referredBy: {
                    in: await prisma.user
                        .findMany({
                            where: { id: { in: currentLayerUsers } },
                            select: { referralCode: true },
                        })
                        .then((users) => users.map((u) => u.referralCode)),
                },
                ...REAL_USER_WHERE,
            },
            select: {
                id: true,
                username: true,
                createdAt: true,
                referralCode: true,
            },
        });

        for (const user of nextLayerUsers) {
            teamMembers.push({ user, layer });
        }

        currentLayerUsers = nextLayerUsers.map((u) => u.id);
    }

    return teamMembers;
}

// Helper function to calculate user and downlink stats
export async function calculateUserStats(userId: string) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isDemo: true },
    });

    if (user?.isDemo) {
        return {
            totalRecharge: 0,
            directRecharge: 0,
            downlinkRecharge: 0,
            totalWithdraw: 0,
            directWithdraw: 0,
            downlinkWithdraw: 0,
            totalBet: 0,
            directBet: 0,
            downlinkBet: 0,
            allDownlinksCount: 0,
            directDownlinksCount: 0,
            totalSubordinatesCount: 0,
            subordinatesWithFirstDepositCount: 0,
            subordinatesWithBetsCount: 0,
            userFirstDeposit: 0,
        };
    }

    const teamMembers = await getTeamMembers(userId, 6);
    const directDownlinks = teamMembers.filter((m) => m.layer === 1);
    const directDownlinkIds = directDownlinks.map((m) => m.user.id);
    const allDownlinkIds = teamMembers.map((m) => m.user.id);

    // Calculate user's own stats
    const [
        userWingoBets,
        userFiveDBets,
        userK3Bets,
        userMotoBets,
        userTrxWingoBets,
        userInoutBets,
        userDeposits,
        userWithdrawals,
        userFirstDeposit,
    ] = await Promise.all([
        prisma.wingoBet.aggregate({
            where: { userId },
            _sum: { betAmount: true },
        }),
        prisma.fiveDBet.aggregate({
            where: { userId },
            _sum: { betAmount: true },
        }),
        prisma.k3Bet.aggregate({
            where: { userId },
            _sum: { betAmount: true },
        }),
        prisma.motoBet.aggregate({
            where: { userId },
            _sum: { betAmount: true },
        }),
        prisma.trxWingoBet.aggregate({
            where: { userId },
            _sum: { betAmount: true },
        }),
        prisma.inoutBet.aggregate({
            where: { userId },
            _sum: { betAmount: true },
        }),
        prisma.deposit.aggregate({
            where: { userId, status: "SUCCESS" },
            _sum: { amount: true },
        }),
        prisma.withdraw.aggregate({
            where: { userId, status: "SUCCESS" },
            _sum: { amount: true },
        }),
        prisma.deposit.findFirst({
            where: { userId, status: "SUCCESS" },
            orderBy: { createdAt: "asc" },
            select: { amount: true },
        }),
    ]);

    const totalBet =
        (userWingoBets._sum.betAmount || 0) +
        (userFiveDBets._sum.betAmount || 0) +
        (userK3Bets._sum.betAmount || 0) +
        (userMotoBets._sum.betAmount || 0) +
        (userTrxWingoBets._sum.betAmount || 0) +
        (userInoutBets._sum.betAmount || 0);

    const totalRecharge = userDeposits._sum.amount || 0;
    const totalWithdraw = userWithdrawals._sum.amount || 0;

    // Calculate direct downlinks stats (level 1 only)
    let directRecharge = 0;
    let directWithdraw = 0;
    let directBet = 0;

    if (directDownlinkIds.length > 0) {
        const [
            directWingoBets,
            directFiveDBets,
            directK3Bets,
            directMotoBets,
            directTrxWingoBets,
            directInoutBets,
            directDeposits,
            directWithdrawals,
        ] = await Promise.all([
            prisma.wingoBet.aggregate({
                where: { userId: { in: directDownlinkIds } },
                _sum: { betAmount: true },
            }),
            prisma.fiveDBet.aggregate({
                where: { userId: { in: directDownlinkIds } },
                _sum: { betAmount: true },
            }),
            prisma.k3Bet.aggregate({
                where: { userId: { in: directDownlinkIds } },
                _sum: { betAmount: true },
            }),
            prisma.motoBet.aggregate({
                where: { userId: { in: directDownlinkIds } },
                _sum: { betAmount: true },
            }),
            prisma.trxWingoBet.aggregate({
                where: { userId: { in: directDownlinkIds } },
                _sum: { betAmount: true },
            }),
            prisma.inoutBet.aggregate({
                where: { userId: { in: directDownlinkIds } },
                _sum: { betAmount: true },
            }),
            prisma.deposit.aggregate({
                where: {
                    userId: { in: directDownlinkIds },
                    status: "SUCCESS",
                },
                _sum: { amount: true },
            }),
            prisma.withdraw.aggregate({
                where: {
                    userId: { in: directDownlinkIds },
                    status: "SUCCESS",
                },
                _sum: { amount: true },
            }),
        ]);

        directBet =
            (directWingoBets._sum.betAmount || 0) +
            (directFiveDBets._sum.betAmount || 0) +
            (directK3Bets._sum.betAmount || 0) +
            (directMotoBets._sum.betAmount || 0) +
            (directTrxWingoBets._sum.betAmount || 0) +
            (directInoutBets._sum.betAmount || 0);

        directRecharge = directDeposits._sum.amount || 0;
        directWithdraw = directWithdrawals._sum.amount || 0;
    }

    // Calculate all downlinks stats (level 1-6)
    let downlinkRecharge = 0;
    let downlinkWithdraw = 0;
    let downlinkBet = 0;

    if (allDownlinkIds.length > 0) {
        const [
            downlinkWingoBets,
            downlinkFiveDBets,
            downlinkK3Bets,
            downlinkMotoBets,
            downlinkTrxWingoBets,
            downlinkInoutBets,
            downlinkDeposits,
            downlinkWithdrawals,
        ] = await Promise.all([
            prisma.wingoBet.aggregate({
                where: { userId: { in: allDownlinkIds } },
                _sum: { betAmount: true },
            }),
            prisma.fiveDBet.aggregate({
                where: { userId: { in: allDownlinkIds } },
                _sum: { betAmount: true },
            }),
            prisma.k3Bet.aggregate({
                where: { userId: { in: allDownlinkIds } },
                _sum: { betAmount: true },
            }),
            prisma.motoBet.aggregate({
                where: { userId: { in: allDownlinkIds } },
                _sum: { betAmount: true },
            }),
            prisma.trxWingoBet.aggregate({
                where: { userId: { in: allDownlinkIds } },
                _sum: { betAmount: true },
            }),
            prisma.inoutBet.aggregate({
                where: { userId: { in: allDownlinkIds } },
                _sum: { betAmount: true },
            }),
            prisma.deposit.aggregate({
                where: {
                    userId: { in: allDownlinkIds },
                    status: "SUCCESS",
                },
                _sum: { amount: true },
            }),
            prisma.withdraw.aggregate({
                where: {
                    userId: { in: allDownlinkIds },
                    status: "SUCCESS",
                },
                _sum: { amount: true },
            }),
        ]);

        downlinkBet =
            (downlinkWingoBets._sum.betAmount || 0) +
            (downlinkFiveDBets._sum.betAmount || 0) +
            (downlinkK3Bets._sum.betAmount || 0) +
            (downlinkMotoBets._sum.betAmount || 0) +
            (downlinkTrxWingoBets._sum.betAmount || 0) +
            (downlinkInoutBets._sum.betAmount || 0);

        downlinkRecharge = downlinkDeposits._sum.amount || 0;
        downlinkWithdraw = downlinkWithdrawals._sum.amount || 0;
    }

    // Count subordinates who made first deposit
    const subordinatesWithFirstDeposit = await prisma.deposit.groupBy({
        where: {
            userId: { in: allDownlinkIds },
            status: "SUCCESS",
        },
        by: ["userId"],
        _min: {
            createdAt: true,
        },
    });
    const subordinatesWithFirstDepositCount =
        subordinatesWithFirstDeposit.length;

    // Count subordinates who placed any bet
    const subordinatesWithBets = new Set<string>();

    if (allDownlinkIds.length > 0) {
        const [
            wingoBetUsers,
            fiveDBetUsers,
            k3BetUsers,
            motoBetUsers,
            trxWingoBetUsers,
            inoutBetUsers,
        ] = await Promise.all([
            prisma.wingoBet.findMany({
                where: { userId: { in: allDownlinkIds } },
                select: { userId: true },
                distinct: ["userId"],
            }),
            prisma.fiveDBet.findMany({
                where: { userId: { in: allDownlinkIds } },
                select: { userId: true },
                distinct: ["userId"],
            }),
            prisma.k3Bet.findMany({
                where: { userId: { in: allDownlinkIds } },
                select: { userId: true },
                distinct: ["userId"],
            }),
            prisma.motoBet.findMany({
                where: { userId: { in: allDownlinkIds } },
                select: { userId: true },
                distinct: ["userId"],
            }),
            prisma.trxWingoBet.findMany({
                where: { userId: { in: allDownlinkIds } },
                select: { userId: true },
                distinct: ["userId"],
            }),
            prisma.inoutBet.findMany({
                where: { userId: { in: allDownlinkIds } },
                select: { userId: true },
                distinct: ["userId"],
            }),
        ]);

        [
            ...wingoBetUsers,
            ...fiveDBetUsers,
            ...k3BetUsers,
            ...motoBetUsers,
            ...trxWingoBetUsers,
            ...inoutBetUsers,
        ].forEach((bet) => {
            subordinatesWithBets.add(bet.userId);
        });
    }
    const subordinatesWithBetsCount = subordinatesWithBets.size;

    return {
        totalRecharge,
        directRecharge,
        downlinkRecharge,
        totalWithdraw,
        directWithdraw,
        downlinkWithdraw,
        totalBet,
        directBet,
        downlinkBet,
        allDownlinksCount: allDownlinkIds.length,
        directDownlinksCount: directDownlinkIds.length,
        totalSubordinatesCount: allDownlinkIds.length,
        subordinatesWithFirstDepositCount,
        subordinatesWithBetsCount,
        userFirstDeposit: userFirstDeposit?.amount || 0,
    };
}
