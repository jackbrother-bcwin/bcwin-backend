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
 */
const LUCKY_REWARDS: ReadonlyArray<{ amount: number; probability: number }> = [
    { amount: 2, probability: 28 },
    { amount: 5, probability: 25 },
    { amount: 10, probability: 18 },
    { amount: 50, probability: 12 },
    { amount: 100, probability: 10 },
    { amount: 1000, probability: 5 },
    { amount: 5000, probability: 2 },
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
export async function seedLuckySpin(prisma: PrismaClient): Promise<void> {
    console.log("🎡 Seeding spin wheel rewards & rules (INVITE + LUCKY)…");

    await Promise.all([
        prisma.luckySpinReward.deleteMany({}),
        prisma.luckySpinRule.deleteMany({}),
    ]);

    await prisma.luckySpinReward.createMany({
        data: [
            ...INVITE_REWARDS.map((r) => ({
                kind: "INVITE" as const,
                amount: r.amount,
                probability: r.probability,
                isActive: true,
            })),
            ...LUCKY_REWARDS.map((r) => ({
                kind: "LUCKY" as const,
                amount: r.amount,
                probability: r.probability,
                isActive: true,
            })),
        ],
    });

    await prisma.luckySpinRule.createMany({
        data: [
            ...INVITE_RULES.map((r) => ({
                kind: "INVITE" as const,
                minDeposit: r.minDeposit,
                spinChances: r.spinChances,
                isActive: true,
            })),
            ...LUCKY_RULES.map((r) => ({
                kind: "LUCKY" as const,
                minDeposit: r.minDeposit,
                spinChances: r.spinChances,
                isActive: true,
            })),
        ],
    });

    console.log(
        `   ✅ INVITE rewards ${INVITE_REWARDS.length}, LUCKY rewards ${LUCKY_REWARDS.length}`
    );
    console.log(
        `   ✅ INVITE rules ${INVITE_RULES.length}, LUCKY rules ${LUCKY_RULES.length}`
    );
}
