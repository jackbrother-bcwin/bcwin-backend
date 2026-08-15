import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { mapGameToRebateCategory } from "./gameCategory";
import type { RebateGameCategory } from "@bcwin/db";

const logger = new Logger("self-rebate");

/** Fallback if SelfRebateRateConfig missing (VIP0=0; VIP1–10 as product) */
const FALLBACK_RATE: Readonly<Record<number, number>> = {
    0: 0,
    1: 0.05,
    2: 0.05,
    3: 0.1,
    4: 0.1,
    5: 0.1,
    6: 0.15,
    7: 0.15,
    8: 0.15,
    9: 0.2,
    10: 0.3,
};

let rateCache: { at: number; map: Map<number, number> } | null = null;
const RATE_CACHE_MS = 60_000;

export async function getSelfRebateRatePercent(
    vipLevel: number
): Promise<number> {
    const n = Math.max(0, Math.min(10, Math.floor(Number(vipLevel) || 0)));
    if (!rateCache || Date.now() - rateCache.at > RATE_CACHE_MS) {
        try {
            const rows = await prisma.selfRebateRateConfig.findMany({
                select: { vipLevel: true, ratePercent: true },
            });
            rateCache = {
                at: Date.now(),
                map: new Map(rows.map((r) => [r.vipLevel, r.ratePercent])),
            };
        } catch {
            rateCache = { at: Date.now(), map: new Map() };
        }
    }
    return rateCache.map.get(n) ?? FALLBACK_RATE[n] ?? 0;
}

/**
 * Returns today's date string in IST (YYYY-MM-DD).
 */
function todayIst(): string {
    const now = new Date();
    // IST = UTC + 5:30
    const istMs = now.getTime() + (5.5 * 60 * 60 * 1000);
    const ist = new Date(istMs);
    const y = ist.getUTCFullYear();
    const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
    const d = String(ist.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

export type AccrueSelfRebateOpts = {
    userId: string;
    betAmount: number;
    game: string;
    betId?: string;
    gameCategory?: RebateGameCategory;
    inoutCategory?: string | null;
};

/**
 * Self-rebate calculator: 0.1% cashback on user's own bets.
 * Accrued per-bet, claimable once daily, expires next day at 01:00 IST.
 */
export class SelfRebateCalculator {
    /**
     * Accrue a self-rebate row for a single bet.
     */
    static async accrueForBet(opts: AccrueSelfRebateOpts): Promise<void> {
        const { userId, betAmount, game, betId } = opts;
        try {
            if (!userId || betAmount <= 0) return;

            // Skip demo users
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    isDemo: true,
                    vipLevel: { select: { currentLevel: true } },
                },
            });
            if (!user || user.isDemo) return;

            const xpVip = user.vipLevel?.currentLevel ?? 0;
            const rate = await getSelfRebateRatePercent(xpVip);
            if (rate <= 0) return;

            const category =
                opts.gameCategory ??
                mapGameToRebateCategory(game, opts.inoutCategory);

            const amount = betAmount * (rate / 100);
            if (amount <= 0) return;

            const date = todayIst();

            await prisma.selfRebate.create({
                data: {
                    userId,
                    betAmount,
                    rate,
                    amount,
                    vipLevel: xpVip,
                    game: String(game).toUpperCase(),
                    gameCategory: category,
                    betId: betId ?? null,
                    date,
                    claimed: false,
                    expired: false,
                },
            });

            logger.debug(
                `Self-rebate ${amount.toFixed(4)} (${rate}% VIP${xpVip} of ${betAmount}) for ${userId} on ${date}`
            );
        } catch (error) {
            logger.error(
                `Error accruing self-rebate for user ${opts.userId}:`,
                error
            );
        }
    }

    /**
     * Expire all unclaimed self-rebates from days before today (IST).
     * Called daily at 01:00 IST by the scheduler.
     */
    static async expireUnclaimed(): Promise<void> {
        try {
            const today = todayIst();

            const result = await prisma.selfRebate.updateMany({
                where: {
                    claimed: false,
                    expired: false,
                    date: { lt: today },
                },
                data: {
                    expired: true,
                },
            });

            if (result.count > 0) {
                logger.info(
                    `Expired ${result.count} unclaimed self-rebate rows (before ${today})`
                );
            } else {
                logger.info("No unclaimed self-rebates to expire");
            }
        } catch (error) {
            logger.error("Error expiring unclaimed self-rebates:", error);
        }
    }
}
