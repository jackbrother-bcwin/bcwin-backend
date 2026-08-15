/**
 * Self-rebate % by XP VIP (currentLevel). VIP0 = 0.
 * VIP1–10: 0.05, 0.05, 0.1, 0.1, 0.1, 0.15, 0.15, 0.15, 0.2, 0.3
 */
import type { PrismaClient } from "../generated/prisma/client";

export const SELF_REBATE_RATES_BY_VIP: ReadonlyArray<{
    vipLevel: number;
    ratePercent: number;
}> = [
    { vipLevel: 0, ratePercent: 0 },
    { vipLevel: 1, ratePercent: 0.05 },
    { vipLevel: 2, ratePercent: 0.05 },
    { vipLevel: 3, ratePercent: 0.1 },
    { vipLevel: 4, ratePercent: 0.1 },
    { vipLevel: 5, ratePercent: 0.1 },
    { vipLevel: 6, ratePercent: 0.15 },
    { vipLevel: 7, ratePercent: 0.15 },
    { vipLevel: 8, ratePercent: 0.15 },
    { vipLevel: 9, ratePercent: 0.2 },
    { vipLevel: 10, ratePercent: 0.3 },
];

export async function seedSelfRebateRates(client: PrismaClient): Promise<void> {
    for (const row of SELF_REBATE_RATES_BY_VIP) {
        await client.selfRebateRateConfig.upsert({
            where: { vipLevel: row.vipLevel },
            create: row,
            update: { ratePercent: row.ratePercent },
        });
    }
    console.log("  Self-rebate VIP rates seeded (0–10)");
}
