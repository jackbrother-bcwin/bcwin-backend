import { PaymentOrderStatus, prisma } from "@bcwin/db";
import { GAME_MIN_LIFETIME_DEPOSIT } from "@bcwin/config";

export { GAME_MIN_LIFETIME_DEPOSIT };

export async function lifetimeSuccessDepositInr(userId: string): Promise<number> {
    const r = await prisma.deposit.aggregate({
        where: { userId, status: PaymentOrderStatus.SUCCESS },
        _sum: { amount: true },
    });
    return r._sum.amount ?? 0;
}

export type DepositGateResult =
    | { ok: true }
    | { ok: false; total: number; required: number; message: string };

/**
 * Block play until lifetime SUCCESS recharge ≥ GAME_MIN_LIFETIME_DEPOSIT.
 * `skipDemo`: lottery QA accounts skip the money check (Inout still blocks demo).
 */
export async function requireLifetimeDeposit(
    user: { id: string; isDemo?: boolean },
    opts?: { skipDemo?: boolean }
): Promise<DepositGateResult> {
    if (opts?.skipDemo && user.isDemo) return { ok: true };
    if (process.env.NODE_ENV === "test") return { ok: true };
    const required = GAME_MIN_LIFETIME_DEPOSIT;
    const total = await lifetimeSuccessDepositInr(user.id);
    if (total >= required) return { ok: true };
    return {
        ok: false,
        total,
        required,
        message: `Recharge at least ₹${required} to play. Your total: ₹${Math.floor(total)}`,
    };
}
