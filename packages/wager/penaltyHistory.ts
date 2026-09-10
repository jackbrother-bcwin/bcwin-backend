import type { Prisma } from "@bcwin/db";
import type { UserWagerStatus } from "./index";

export function penaltyHistoryAmounts(
    previousFactor: number,
    resultingFactor: number,
    before: UserWagerStatus,
    after: UserWagerStatus
) {
    return {
        previousFactor, resultingFactor,
        beforeNeedToBet: before.totalNeedToBet,
        afterNeedToBet: after.totalNeedToBet,
        beforePenaltyWager: before.penaltyWagerNeeded,
        afterPenaltyWager: after.penaltyWagerNeeded,
        beforeRewardWager: before.rewardWagerNeeded,
        afterRewardWager: after.rewardWagerNeeded,
    };
}

export async function roundPeriodNumber(tx: Prisma.TransactionClient, game: string, id: string) {
    const query = { where: { id }, select: { periodNumber: true } };
    const period = game === "WINGO" ? await tx.wingoPeriod.findUnique(query)
        : game === "TRXWINGO" ? await tx.trxWingoPeriod.findUnique(query)
        : game === "5D" ? await tx.fiveDPeriod.findUnique(query)
        : game === "K3" ? await tx.k3Period.findUnique(query)
        : await tx.motoPeriod.findUnique(query);
    return period?.periodNumber ?? null;
}
