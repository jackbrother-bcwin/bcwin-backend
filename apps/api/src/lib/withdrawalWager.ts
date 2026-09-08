import { Prisma } from "@bcwin/db";
import { getUserWagerStatus } from "./wagerEngine";
import { endTrxVisit } from "./trxEntry";

export class WithdrawalValidationError extends Error {}

/** Call inside the transaction that creates the withdrawal. */
export async function debitWithdrawal(
    tx: Prisma.TransactionClient,
    userId: string,
    amount: number,
    dailyLimit: number,
    dayStart: Date,
    dayEnd: Date
) {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.balance < amount) {
        throw new WithdrawalValidationError("Insufficient balance");
    }
    const count = await tx.withdraw.count({
        where: { userId, createdAt: { gte: dayStart, lte: dayEnd } },
    });
    if (count >= dailyLimit) {
        throw new WithdrawalValidationError("You have reached the maximum number of withdraw applications per day");
    }
    if (!user.isDemo) {
        const wager = await getUserWagerStatus(userId, tx);
        if (wager.isWithdrawalFrozen || wager.totalNeedToBet > 0) {
            throw new WithdrawalValidationError(
                `Withdrawal is frozen until wager requirement of ₹${wager.totalNeedToBet} is completed`
            );
        }
    }
    await endTrxVisit(tx, userId);
    return tx.user.update({
        where: { id: userId },
        data: {
            balance: { decrement: amount },
            zeroWagerEnabled: false,
            ...(user.zeroWagerEnabled
                ? { zeroWagerConsumedAt: new Date() }
                : { hasIllegalBetPenalty: false, illegalBetPenaltyFactor: null }),
        },
        select: { balance: true },
    });
}
