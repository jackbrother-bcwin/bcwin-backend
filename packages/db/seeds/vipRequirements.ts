import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/**
 * VIP Level Requirements (0-10)
 * Based on cumulative XP required to reach each VIP level
 */
/**
 * Dual-track thresholds (ADR-0012):
 * - expRequired / rewards → XP VIP (currentLevel)
 * - teamSize / teamBetting / teamDeposit → rebateLevel (AND, L1–L6 totals)
 * Prod dump mapping: teamBetting large, teamDeposit mid, teamSize count.
 */
const vipRequirements = [
    {
        level: 0,
        expRequired: 0,
        levelUpReward: 0,
        monthlyReward: 0,
        rebateRate: null as string | null,
        rebatePercentage: 0,
        teamSize: 0,
        teamBetting: 0,
        teamDeposit: 0,
    },
    {
        level: 1,
        expRequired: 3000,
        levelUpReward: 30,
        monthlyReward: 5,
        rebateRate: null,
        rebatePercentage: 0,
        teamSize: 10,
        teamBetting: 50_000,
        teamDeposit: 10_000,
    },
    {
        level: 2,
        expRequired: 30_000,
        levelUpReward: 150,
        monthlyReward: 15,
        rebateRate: null,
        rebatePercentage: 0,
        teamSize: 30,
        teamBetting: 200_000,
        teamDeposit: 50_000,
    },
    {
        level: 3,
        expRequired: 400_000,
        levelUpReward: 690,
        monthlyReward: 69,
        rebateRate: null,
        rebatePercentage: 0,
        teamSize: 80,
        teamBetting: 800_000,
        teamDeposit: 200_000,
    },
    {
        level: 4,
        expRequired: 4_000_000,
        levelUpReward: 1290,
        monthlyReward: 690,
        rebateRate: null,
        rebatePercentage: 0,
        teamSize: 200,
        teamBetting: 3_000_000,
        teamDeposit: 800_000,
    },
    {
        level: 5,
        expRequired: 20_000_000,
        levelUpReward: 5900,
        monthlyReward: 2690,
        rebateRate: null,
        rebatePercentage: 0,
        teamSize: 500,
        teamBetting: 10_000_000,
        teamDeposit: 3_000_000,
    },
    {
        level: 6,
        expRequired: 80_000_000,
        levelUpReward: 16900,
        monthlyReward: 6900,
        rebateRate: null,
        rebatePercentage: 0,
        teamSize: 1200,
        teamBetting: 35_000_000,
        teamDeposit: 10_000_000,
    },
    {
        level: 7,
        expRequired: 300_000_000,
        levelUpReward: 69000,
        monthlyReward: 26900,
        rebateRate: null,
        rebatePercentage: 0,
        teamSize: 2500,
        teamBetting: 100_000_000,
        teamDeposit: 35_000_000,
    },
    {
        level: 8,
        expRequired: 1_000_000_000,
        levelUpReward: 169000,
        monthlyReward: 69000,
        rebateRate: null,
        rebatePercentage: 0,
        teamSize: 5000,
        teamBetting: 300_000_000,
        teamDeposit: 100_000_000,
    },
    {
        level: 9,
        expRequired: 5_000_000_000,
        levelUpReward: 690000,
        monthlyReward: 169000,
        rebateRate: null,
        rebatePercentage: 0,
        teamSize: 10_000,
        teamBetting: 800_000_000,
        teamDeposit: 300_000_000,
    },
    {
        level: 10,
        expRequired: 10_000_000_000,
        levelUpReward: 1_690_000,
        monthlyReward: 690_000,
        rebateRate: null,
        rebatePercentage: 0,
        teamSize: 20_000,
        teamBetting: 2_000_000_000,
        teamDeposit: 800_000_000,
    },
];

export async function seedVipRequirements() {
    console.log("🌱 Seeding VIP level requirements...");

    for (const requirement of vipRequirements) {
        await prisma.vipLevelRequirement.upsert({
            where: { level: requirement.level },
            update: {
                expRequired: requirement.expRequired,
                levelUpReward: requirement.levelUpReward,
                monthlyReward: requirement.monthlyReward,
                rebateRate: requirement.rebateRate,
                rebatePercentage: requirement.rebatePercentage,
                teamSize: requirement.teamSize,
                teamBetting: requirement.teamBetting,
                teamDeposit: requirement.teamDeposit,
            },
            create: requirement,
        });

        console.log(
            `  ✓ L${requirement.level}: XP ${formatAmount(
                requirement.expRequired
            )} | team size ${requirement.teamSize} bet ${formatAmount(
                requirement.teamBetting
            )} dep ${formatAmount(requirement.teamDeposit)} | rewards ₹${
                requirement.levelUpReward
            }/₹${requirement.monthlyReward}`
        );
    }

    console.log("✅ VIP requirements seeded successfully!\n");
}

function formatAmount(amount: number): string {
    if (amount >= 1000000000) return `${amount / 1000000000}B`;
    if (amount >= 1000000) return `${amount / 1000000}M`;
    if (amount >= 1000) return `${amount / 1000}K`;
    return amount.toString();
}

// Run if called directly
if (require.main === module) {
    seedVipRequirements()
        .catch((error) => {
            console.error("❌ Error seeding VIP requirements:", error);
            process.exit(1);
        })
        .finally(async () => {
            await prisma.$disconnect();
        });
}
