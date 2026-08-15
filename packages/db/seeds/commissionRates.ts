import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/**
 * Commission rates for each VIP level (0-10)
 * Based on the commission and promotion documentation
 */
const commissionRates = [
    {
        vipLevel: 0,
        layer1: 0.6,
        layer2: 0.18,
        layer3: 0.054,
        layer4: 0.0162,
        layer5: 0.00486,
        layer6: 0.001458,
    },
    {
        vipLevel: 1,
        layer1: 0.7,
        layer2: 0.245,
        layer3: 0.08575,
        layer4: 0.030012,
        layer5: 0.010504,
        layer6: 0.003677,
    },
    {
        vipLevel: 2,
        layer1: 0.75,
        layer2: 0.28125,
        layer3: 0.105469,
        layer4: 0.039551,
        layer5: 0.014832,
        layer6: 0.005562,
    },
    {
        vipLevel: 3,
        layer1: 0.8,
        layer2: 0.32,
        layer3: 0.128,
        layer4: 0.0512,
        layer5: 0.02048,
        layer6: 0.008192,
    },
    {
        vipLevel: 4,
        layer1: 0.85,
        layer2: 0.36125,
        layer3: 0.153531,
        layer4: 0.065251,
        layer5: 0.027732,
        layer6: 0.011786,
    },
    {
        vipLevel: 5,
        layer1: 0.9,
        layer2: 0.405,
        layer3: 0.18225,
        layer4: 0.082013,
        layer5: 0.036906,
        layer6: 0.016608,
    },
    {
        vipLevel: 6,
        layer1: 1.0,
        layer2: 0.5,
        layer3: 0.25,
        layer4: 0.125,
        layer5: 0.0625,
        layer6: 0.03125,
    },
    {
        vipLevel: 7,
        layer1: 1.1,
        layer2: 0.605,
        layer3: 0.33275,
        layer4: 0.183013,
        layer5: 0.100657,
        layer6: 0.055361,
    },
    {
        vipLevel: 8,
        layer1: 1.2,
        layer2: 0.72,
        layer3: 0.432,
        layer4: 0.2592,
        layer5: 0.15552,
        layer6: 0.093312,
    },
    {
        vipLevel: 9,
        layer1: 1.3,
        layer2: 0.845,
        layer3: 0.54925,
        layer4: 0.357013,
        layer5: 0.232058,
        layer6: 0.150838,
    },
    {
        vipLevel: 10,
        layer1: 1.4,
        layer2: 0.98,
        layer3: 0.686,
        layer4: 0.4802,
        layer5: 0.33614,
        layer6: 0.235298,
    },
];

export async function seedCommissionRates() {
    console.log("🌱 Seeding commission rates...");

    for (const rate of commissionRates) {
        await prisma.commissionRateConfig.upsert({
            where: { vipLevel: rate.vipLevel },
            update: {
                layer1: rate.layer1,
                layer2: rate.layer2,
                layer3: rate.layer3,
                layer4: rate.layer4,
                layer5: rate.layer5,
                layer6: rate.layer6,
            },
            create: rate,
        });

        console.log(
            `  ✓ VIP ${rate.vipLevel}: L1=${rate.layer1}%, L2=${rate.layer2}%, L3=${rate.layer3}%`
        );
    }

    console.log("✅ Commission rates seeded successfully!\n");
}

// Run if called directly
if (require.main === module) {
    seedCommissionRates()
        .catch((error) => {
            console.error("❌ Error seeding commission rates:", error);
            process.exit(1);
        })
        .finally(async () => {
            await prisma.$disconnect();
        });
}
