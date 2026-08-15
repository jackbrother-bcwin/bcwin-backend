/**
 * Seed multi-level rebate rates by VIP level × game category.
 * Source: notes/docs/rebateratio/1.md
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type RebateGameCategory } from "../generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

type Layers = [number, number, number, number, number, number];

const LOTTERY: Layers[] = [
    [0.5, 0.15, 0.0512, 0.0162, 0.00486, 0.001458],
    [0.6, 0.215, 0.06575, 0.025012, 0.010504, 0.003677],
    [0.65, 0.22525, 0.085469, 0.035551, 0.010504, 0.003677],
    [0.75, 0.28125, 0.105469, 0.0512, 0.02048, 0.008192],
    [0.8, 0.30125, 0.153531, 0.065251, 0.027732, 0.011786],
    [0.9, 0.405, 0.18225, 0.082013, 0.036906, 0.016608],
    [1, 0.5, 0.25, 0.125, 0.0625, 0.03125],
    [1.1, 0.605, 0.33275, 0.183013, 0.100657, 0.055361],
    [1.2, 0.72, 0.432, 0.2592, 0.15552, 0.093312],
    [1.3, 0.845, 0.54925, 0.357013, 0.232058, 0.150838],
    [1.4, 0.98, 0.686, 0.4802, 0.33614, 0.235298],
];

/** Casino / Slots / Sports / Rummy share the same table in 1.md */
const CASINO_SPORTS_RUMMY: Layers[] = [
    [0.25, 0.07, 0.021, 0.0081, 0.00243, 0.000729],
    [0.3, 0.1125, 0.032875, 0.011006, 0.005252, 0.001838],
    [0.325, 0.120625, 0.042734, 0.015775, 0.005252, 0.001838],
    [0.375, 0.140625, 0.052734, 0.0256, 0.01024, 0.004096],
    [0.405, 0.150625, 0.076766, 0.032625, 0.013866, 0.005893],
    [0.45, 0.2025, 0.091125, 0.041006, 0.018453, 0.008304],
    [0.5, 0.25, 0.125, 0.0625, 0.03125, 0.015625],
    [0.55, 0.3025, 0.166375, 0.091506, 0.050328, 0.027681],
    [0.6, 0.36, 0.216, 0.1296, 0.07776, 0.046656],
    [0.65, 0.4225, 0.274625, 0.178506, 0.116029, 0.075419],
    [0.7, 0.49, 0.343, 0.2401, 0.16807, 0.117649],
];

function rowsFor(
    category: RebateGameCategory,
    table: Layers[]
): {
    vipLevel: number;
    category: RebateGameCategory;
    layer1: number;
    layer2: number;
    layer3: number;
    layer4: number;
    layer5: number;
    layer6: number;
}[] {
    return table.map((layers, vipLevel) => ({
        vipLevel,
        category,
        layer1: layers[0],
        layer2: layers[1],
        layer3: layers[2],
        layer4: layers[3],
        layer5: layers[4],
        layer6: layers[5],
    }));
}

export async function seedRebateRates(client: PrismaClient = prisma) {
    console.log("Seeding rebate rate configs (category multi-level)...");

    const data = [
        ...rowsFor("LOTTERY", LOTTERY),
        ...rowsFor("SLOTS", CASINO_SPORTS_RUMMY),
        ...rowsFor("CASINO", CASINO_SPORTS_RUMMY),
        ...rowsFor("SPORTS", CASINO_SPORTS_RUMMY),
        ...rowsFor("RUMMY", CASINO_SPORTS_RUMMY),
    ];

    for (const row of data) {
        await client.rebateRateConfig.upsert({
            where: {
                vipLevel_category: {
                    vipLevel: row.vipLevel,
                    category: row.category,
                },
            },
            create: row,
            update: {
                layer1: row.layer1,
                layer2: row.layer2,
                layer3: row.layer3,
                layer4: row.layer4,
                layer5: row.layer5,
                layer6: row.layer6,
            },
        });
    }

    console.log(`  ✓ Upserted ${data.length} rebate rate rows`);
}

// Run if called directly
if (typeof require !== "undefined" && require.main === module) {
    seedRebateRates()
        .catch((e) => {
            console.error("❌ Error seeding rebate rates:", e);
            process.exit(1);
        })
        .finally(async () => {
            await prisma.$disconnect();
        });
}
