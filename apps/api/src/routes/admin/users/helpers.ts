import { prisma } from "@bcwin/db";
import { REAL_USER_WHERE } from "@/lib/realUserFilter";
import { moneyStatsByUser, betStatsByUser } from "@/lib/adminUserMetrics";

// Carry referral codes forward instead of re-reading every parent at each level.
export async function getTeamMembers(userId: string, maxLayers = 6) {
    const root = await prisma.user.findUnique({
        where: { id: userId }, select: { referralCode: true },
    });
    type Member = { id: string; username: string; createdAt: Date; referralCode: string };
    const teamMembers: Array<{ user: Member; layer: number }> = [];
    let codes = root ? [root.referralCode] : [];
    for (let layer = 1; layer <= maxLayers && codes.length; layer++) {
        const next: Member[] = [];
        for (let offset = 0; offset < codes.length; offset += 2000) {
            const users = await prisma.user.findMany({
                where: { referredBy: { in: codes.slice(offset, offset + 2000) }, ...REAL_USER_WHERE },
                select: { id: true, username: true, createdAt: true, referralCode: true },
            });
            next.push(...users);
        }
        for (const user of next) teamMembers.push({ user, layer });
        codes = next.map((user) => user.referralCode);
    }
    return teamMembers;
}

export async function calculateUserStats(userId: string) {
    const user = await prisma.user.findUnique({
        where: { id: userId }, select: { isDemo: true },
    });
    const teamMembers = user?.isDemo ? [] : await getTeamMembers(userId, 6);
    const allIds = teamMembers.map((member) => member.user.id);
    const directIds = teamMembers.filter((member) => member.layer === 1).map((member) => member.user.id);
    const ids = user?.isDemo ? [] : [userId, ...allIds];
    const [deposits, withdrawals, bets, firstDeposit] = await Promise.all([
        moneyStatsByUser("deposit", ids),
        moneyStatsByUser("withdrawal", ids),
        // Preserve the existing lifetime contract; daily analysis excludes rollbacks.
        betStatsByUser(ids, undefined, undefined, false),
        user?.isDemo ? null : prisma.deposit.findFirst({
            where: { userId, status: "SUCCESS" },
            orderBy: { createdAt: "asc" }, select: { amount: true },
        }),
    ]);
    const sum = (map: Map<string, { amount: number }>, members: string[]) =>
        members.reduce((total, id) => total + (map.get(id)?.amount ?? 0), 0);
    return {
        totalRecharge: deposits.get(userId)?.amount ?? 0,
        directRecharge: sum(deposits, directIds),
        downlinkRecharge: sum(deposits, allIds),
        totalWithdraw: withdrawals.get(userId)?.amount ?? 0,
        directWithdraw: sum(withdrawals, directIds),
        downlinkWithdraw: sum(withdrawals, allIds),
        totalBet: bets.get(userId)?.amount ?? 0,
        directBet: sum(bets, directIds),
        downlinkBet: sum(bets, allIds),
        allDownlinksCount: allIds.length,
        directDownlinksCount: directIds.length,
        totalSubordinatesCount: allIds.length,
        subordinatesWithFirstDepositCount: allIds.filter((id) => deposits.has(id)).length,
        subordinatesWithBetsCount: allIds.filter((id) => bets.has(id)).length,
        userFirstDeposit: firstDeposit?.amount ?? 0,
    };
}
