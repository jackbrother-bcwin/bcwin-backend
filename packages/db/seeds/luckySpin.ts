import type { PrismaClient } from "../generated/prisma/client";

/**
 * Invite Wheel — clockwise from top (SpinPage PRIZES).
 */
const INVITE_REWARDS: ReadonlyArray<{ amount: number; probability: number }> = [
    { amount: 10, probability: 40 },
    { amount: 19, probability: 22 },
    { amount: 29, probability: 15 },
    { amount: 100, probability: 6 },
    { amount: 299, probability: 2 },
    { amount: 439, probability: 1 },
    { amount: 66, probability: 10 },
    { amount: 199, probability: 4 },
];

/**
 * Lucky Spin — rupees only (iPhone on FE is visual only; never awarded).
 * Amounts match LuckySpinPage cash slices:
 *   ₹50, ₹5000, ₹10, ₹2, ₹100, ₹1000, ₹5
 *
 * ADR-0023: ₹2+₹5+₹10 ≈ 95.99% (more on smaller; leftover from 0.01% ₹1000),
 * ₹50+₹100 = 4%, ₹1000 = 0.01%, ₹5000 = 0 (same as iPhone).
 */
const LUCKY_REWARDS: ReadonlyArray<{ amount: number; probability: number }> = [
    { amount: 2, probability: 40.42 },
    { amount: 5, probability: 32.33 },
    { amount: 10, probability: 23.24 },
    { amount: 50, probability: 2.5 },
    { amount: 100, probability: 1.5 },
    { amount: 1000, probability: 0.01 },
    { amount: 5000, probability: 0 },
];

const INVITE_RULES: ReadonlyArray<{ minDeposit: number; spinChances: number }> = [
    { minDeposit: 100, spinChances: 1 },
    { minDeposit: 500, spinChances: 1 },
    { minDeposit: 1000, spinChances: 1 },
    { minDeposit: 3000, spinChances: 2 },
    { minDeposit: 10000, spinChances: 3 },
];

const LUCKY_RULES: ReadonlyArray<{ minDeposit: number; spinChances: number }> = [
    { minDeposit: 100, spinChances: 1 },
    { minDeposit: 300, spinChances: 1 },
    { minDeposit: 500, spinChances: 1 },
    { minDeposit: 1000, spinChances: 2 },
    { minDeposit: 5000, spinChances: 3 },
];

/**
 * Idempotent seed for Invite + Lucky spin catalogs.
 */
async function upsertRewards(
    prisma: PrismaClient,
    kind: "INVITE" | "LUCKY",
    rows: ReadonlyArray<{ amount: number; probability: number }>
): Promise<void> {
    const keep = new Set(rows.map((r) => r.amount));
    for (const r of rows) {
        const existing = await prisma.luckySpinReward.findFirst({
            where: { kind, amount: r.amount },
        });
        if (existing) {
            await prisma.luckySpinReward.update({
                where: { id: existing.id },
                data: { probability: r.probability, isActive: true },
            });
        } else {
            await prisma.luckySpinReward.create({
                data: {
                    kind,
                    amount: r.amount,
                    probability: r.probability,
                    isActive: true,
                },
            });
        }
    }
    await prisma.luckySpinReward.updateMany({
        where: { kind, amount: { notIn: [...keep] } },
        data: { isActive: false },
    });
}

async function upsertRules(
    prisma: PrismaClient,
    kind: "INVITE" | "LUCKY",
    rows: ReadonlyArray<{ minDeposit: number; spinChances: number }>
): Promise<void> {
    const existing = await prisma.luckySpinRule.findMany({ where: { kind } });
    if (existing.length === 0) {
        await prisma.luckySpinRule.createMany({
            data: rows.map((r) => ({
                kind,
                minDeposit: r.minDeposit,
                spinChances: r.spinChances,
                isActive: true,
            })),
        });
    }
}

export async function seedLuckySpin(prisma: PrismaClient): Promise<void> {
    console.log("🎡 Seeding spin wheel rewards & rules (INVITE + LUCKY)…");

    await upsertRewards(prisma, "INVITE", INVITE_REWARDS);
    await upsertRewards(prisma, "LUCKY", LUCKY_REWARDS);
    await upsertRules(prisma, "INVITE", INVITE_RULES);
    await upsertRules(prisma, "LUCKY", LUCKY_RULES);

    console.log(
        `   ✅ INVITE rewards ${INVITE_REWARDS.length}, LUCKY rewards ${LUCKY_REWARDS.length}`
    );
    console.log(
        `   ✅ INVITE rules ${INVITE_RULES.length}, LUCKY rules ${LUCKY_RULES.length}`
    );
}
