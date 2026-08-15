/**
 * Seed realistic multi-level category rebate history for FE testing.
 *
 * Default receiver: user_9855641885 (referral user_9855641885-59967363)
 * Override: RECEIVER_REF=your-code bun scripts/seed-rebate-history.ts
 *
 * Run:  cd backend && bun --env-file .env scripts/seed-rebate-history.ts
 *
 * Creates ~40 rows across dates / categories / layers / settled flags.
 * Idempotent: deletes previous rows tagged with note in game prefix SEED_REBATE_
 * Actually we tag via betId starting with "seed-rebate-".
 */
import { PrismaPg } from "@prisma/adapter-pg";
import {
    PrismaClient,
    type RebateGameCategory,
} from "../packages/db/generated/prisma/client";
import { seedRebateRates } from "../packages/db/seeds/rebateRates";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const RECEIVER_REF =
    process.env.RECEIVER_REF ?? "user_9855641885-59967363";
const BET_ID_PREFIX = "seed-rebate-";

type SeedRow = {
    fromUsernameHint: string; // match startsWith or exact among downlines
    layer: number;
    game: string;
    gameCategory: RebateGameCategory;
    betAmount: number;
    rate: number; // percent
    receiverVip: number;
    settled: boolean;
    /** days ago (0 = today IST-ish) */
    daysAgo: number;
    hour?: number;
};

/** VIP5 rates snapshot for sample math (matches 1.md) */
const VIP = 5;
const LOT_L1 = 0.9;
const LOT_L2 = 0.405;
const LOT_L3 = 0.18225;
const CAS_L1 = 0.45;
const CAS_L2 = 0.2025;
const CAS_L3 = 0.091125;

const ROWS: SeedRow[] = [
    // Today — lottery L1
    {
        fromUsernameHint: "asal_d1_",
        layer: 1,
        game: "WINGO",
        gameCategory: "LOTTERY",
        betAmount: 100,
        rate: LOT_L1,
        receiverVip: VIP,
        settled: false,
        daysAgo: 0,
        hour: 10,
    },
    {
        fromUsernameHint: "asal_d2_",
        layer: 1,
        game: "K3",
        gameCategory: "LOTTERY",
        betAmount: 200,
        rate: LOT_L1,
        receiverVip: VIP,
        settled: false,
        daysAgo: 0,
        hour: 11,
    },
    {
        fromUsernameHint: "sdash_d1_",
        layer: 1,
        game: "5D",
        gameCategory: "LOTTERY",
        betAmount: 50,
        rate: LOT_L1,
        receiverVip: VIP,
        settled: false,
        daysAgo: 0,
        hour: 14,
    },
    // Today — slots / casino / sports
    {
        fromUsernameHint: "asal_d3_",
        layer: 1,
        game: "INOUT",
        gameCategory: "SLOTS",
        betAmount: 500,
        rate: CAS_L1,
        receiverVip: VIP,
        settled: false,
        daysAgo: 0,
        hour: 15,
    },
    {
        fromUsernameHint: "asal_d5_",
        layer: 1,
        game: "INOUT",
        gameCategory: "CASINO",
        betAmount: 400,
        rate: CAS_L1,
        receiverVip: VIP,
        settled: false,
        daysAgo: 0,
        hour: 15,
    },
    {
        fromUsernameHint: "asal_d4_",
        layer: 1,
        game: "INOUT",
        gameCategory: "SPORTS",
        betAmount: 300,
        rate: CAS_L1,
        receiverVip: VIP,
        settled: false,
        daysAgo: 0,
        hour: 16,
    },
    // Yesterday — L2 lottery
    {
        fromUsernameHint: "asal_l2_01_",
        layer: 2,
        game: "WINGO",
        gameCategory: "LOTTERY",
        betAmount: 100,
        rate: LOT_L2,
        receiverVip: VIP,
        settled: false,
        daysAgo: 1,
        hour: 9,
    },
    {
        fromUsernameHint: "asal_l2_02_",
        layer: 2,
        game: "MOTO",
        gameCategory: "LOTTERY",
        betAmount: 100,
        rate: LOT_L2,
        receiverVip: VIP,
        settled: false,
        daysAgo: 1,
        hour: 12,
    },
    {
        fromUsernameHint: "asal_l2_11_",
        layer: 2,
        game: "TRXWINGO",
        gameCategory: "LOTTERY",
        betAmount: 150,
        rate: LOT_L2,
        receiverVip: VIP,
        settled: true,
        daysAgo: 1,
        hour: 18,
    },
    {
        fromUsernameHint: "asal_l2_12_",
        layer: 2,
        game: "INOUT",
        gameCategory: "SLOTS",
        betAmount: 200,
        rate: CAS_L2,
        receiverVip: VIP,
        settled: true,
        daysAgo: 1,
        hour: 20,
    },
    {
        fromUsernameHint: "asal_l2_13_",
        layer: 2,
        game: "INOUT",
        gameCategory: "CASINO",
        betAmount: 180,
        rate: CAS_L2,
        receiverVip: VIP,
        settled: true,
        daysAgo: 1,
        hour: 21,
    },
    // 2 days ago — L2 + L3
    {
        fromUsernameHint: "asal_l2_21_",
        layer: 2,
        game: "WINGO",
        gameCategory: "LOTTERY",
        betAmount: 100,
        rate: LOT_L2,
        receiverVip: VIP,
        settled: true,
        daysAgo: 2,
        hour: 8,
    },
    {
        fromUsernameHint: "asal_l2_22_",
        layer: 2,
        game: "WINGO",
        gameCategory: "LOTTERY",
        betAmount: 100,
        rate: LOT_L2,
        receiverVip: VIP,
        settled: true,
        daysAgo: 2,
        hour: 9,
    },
    {
        fromUsernameHint: "asal_l2_23_",
        layer: 2,
        game: "K3",
        gameCategory: "LOTTERY",
        betAmount: 100,
        rate: LOT_L2,
        receiverVip: VIP,
        settled: true,
        daysAgo: 2,
        hour: 10,
    },
    {
        fromUsernameHint: "asal_l2_03_",
        layer: 2,
        game: "INOUT",
        gameCategory: "RUMMY",
        betAmount: 250,
        rate: CAS_L2,
        receiverVip: VIP,
        settled: true,
        daysAgo: 2,
        hour: 14,
    },
    // 3 days ago — L3 (use L2 users as "from" with layer 3 for UI variety)
    {
        fromUsernameHint: "asal_l2_13_",
        layer: 3,
        game: "WINGO",
        gameCategory: "LOTTERY",
        betAmount: 100,
        rate: LOT_L3,
        receiverVip: VIP,
        settled: true,
        daysAgo: 3,
        hour: 11,
    },
    {
        fromUsernameHint: "asal_l2_01_",
        layer: 3,
        game: "INOUT",
        gameCategory: "CASINO",
        betAmount: 400,
        rate: CAS_L3,
        receiverVip: VIP,
        settled: true,
        daysAgo: 3,
        hour: 15,
    },
    // Last week range
    {
        fromUsernameHint: "sdash_d2_",
        layer: 1,
        game: "WINGO",
        gameCategory: "LOTTERY",
        betAmount: 1000,
        rate: LOT_L1,
        receiverVip: VIP,
        settled: true,
        daysAgo: 5,
        hour: 13,
    },
    {
        fromUsernameHint: "asal_d5_",
        layer: 1,
        game: "INOUT",
        gameCategory: "SPORTS",
        betAmount: 800,
        rate: CAS_L1,
        receiverVip: VIP,
        settled: true,
        daysAgo: 6,
        hour: 17,
    },
    {
        fromUsernameHint: "asal_d6_",
        layer: 1,
        game: "5D",
        gameCategory: "LOTTERY",
        betAmount: 75,
        rate: LOT_L1,
        receiverVip: VIP,
        settled: true,
        daysAgo: 7,
        hour: 10,
    },
    // Extra variety — settled mix for filters
    {
        fromUsernameHint: "asal_d1_",
        layer: 1,
        game: "MOTO",
        gameCategory: "LOTTERY",
        betAmount: 120,
        rate: LOT_L1,
        receiverVip: VIP,
        settled: true,
        daysAgo: 4,
        hour: 19,
    },
    {
        fromUsernameHint: "asal_l2_11_",
        layer: 2,
        game: "INOUT",
        gameCategory: "SPORTS",
        betAmount: 350,
        rate: CAS_L2,
        receiverVip: VIP,
        settled: false,
        daysAgo: 0,
        hour: 21,
    },
    {
        fromUsernameHint: "asal_l2_12_",
        layer: 2,
        game: "INOUT",
        gameCategory: "RUMMY",
        betAmount: 180,
        rate: CAS_L2,
        receiverVip: VIP,
        settled: false,
        daysAgo: 1,
        hour: 22,
    },
    {
        fromUsernameHint: "asal_d2_",
        layer: 1,
        game: "TRXWINGO",
        gameCategory: "LOTTERY",
        betAmount: 90,
        rate: LOT_L1,
        receiverVip: VIP,
        settled: true,
        daysAgo: 8,
        hour: 12,
    },
    {
        fromUsernameHint: "asal_d3_",
        layer: 1,
        game: "INOUT",
        gameCategory: "CASINO",
        betAmount: 600,
        rate: CAS_L1,
        receiverVip: VIP,
        settled: true,
        daysAgo: 9,
        hour: 16,
    },
    {
        fromUsernameHint: "asal_l2_21_",
        layer: 2,
        game: "WINGO",
        gameCategory: "LOTTERY",
        betAmount: 100,
        rate: LOT_L2,
        receiverVip: VIP,
        settled: true,
        daysAgo: 10,
        hour: 8,
    },
    {
        fromUsernameHint: "asal_l2_22_",
        layer: 3,
        game: "K3",
        gameCategory: "LOTTERY",
        betAmount: 100,
        rate: LOT_L3,
        receiverVip: VIP,
        settled: true,
        daysAgo: 10,
        hour: 9,
    },
];

function createdAtFor(daysAgo: number, hour = 12): Date {
    const d = new Date();
    // IST-ish wall clock: use local, then set time
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour, Math.floor(Math.random() * 50), Math.floor(Math.random() * 50), 0);
    return d;
}

function amountFrom(betAmount: number, ratePct: number): number {
    // keep 4 decimal places like calculator
    return Math.round(betAmount * (ratePct / 100) * 10000) / 10000;
}

async function main() {
    console.log("Seeding rebate rate configs…");
    await seedRebateRates(prisma);

    const receiver = await prisma.user.findFirst({
        where: { referralCode: RECEIVER_REF },
        select: {
            id: true,
            username: true,
            referralCode: true,
            serialNumber: true,
        },
    });
    if (!receiver) {
        throw new Error(`Receiver not found referralCode=${RECEIVER_REF}`);
    }
    console.log(
        "Receiver:",
        receiver.username,
        receiver.referralCode,
        receiver.id
    );

    // Optional VIP so FE matches rate table
    await prisma.userVipLevel.upsert({
        where: { userId: receiver.id },
        create: {
            userId: receiver.id,
            currentLevel: VIP,
            teamSize: 20,
            teamBetting: 100000,
            teamDeposit: 50000,
        },
        update: { currentLevel: VIP },
    });

    const team = await prisma.user.findMany({
        where: {
            OR: [
                { referredBy: RECEIVER_REF },
                { username: { startsWith: "asal_" } },
                { username: { startsWith: "sdash_" } },
            ],
        },
        select: { id: true, username: true },
    });

    function findFrom(hint: string) {
        const u =
            team.find((t) => t.username.startsWith(hint)) ||
            team.find((t) => t.username.includes(hint.replace(/_$/, "")));
        return u ?? null;
    }

    // Remove previous seed rows for this receiver
    const deleted = await prisma.rebate.deleteMany({
        where: {
            userId: receiver.id,
            betId: { startsWith: BET_ID_PREFIX },
        },
    });
    console.log("Removed previous seed rebates:", deleted.count);

    let created = 0;
    let totalAmount = 0;

    for (let i = 0; i < ROWS.length; i++) {
        const row = ROWS[i]!;
        const from = findFrom(row.fromUsernameHint);
        if (!from) {
            console.warn("  skip (no from user):", row.fromUsernameHint);
            continue;
        }

        const amount = amountFrom(row.betAmount, row.rate);
        const createdAt = createdAtFor(row.daysAgo, row.hour);

        await prisma.rebate.create({
            data: {
                userId: receiver.id,
                fromUserId: from.id,
                amount,
                game: row.game,
                gameCategory: row.gameCategory,
                layer: row.layer,
                receiverVip: row.receiverVip,
                rate: row.rate,
                betAmount: row.betAmount,
                betId: `${BET_ID_PREFIX}${i + 1}`,
                settled: row.settled,
                createdAt,
                updatedAt: createdAt,
            },
        });

        created++;
        totalAmount += amount;
        console.log(
            `  + ${amount.toFixed(4)}  L${row.layer} ${row.gameCategory.padEnd(7)} ${row.game.padEnd(9)} from ${from.username} settled=${row.settled} d-${row.daysAgo}`
        );
    }

    const counts = await prisma.rebate.groupBy({
        by: ["settled"],
        where: { userId: receiver.id },
        _count: true,
        _sum: { amount: true },
    });

    console.log("\nDone.");
    console.log(`  Created ${created} seed rebates, sum ≈ ${totalAmount.toFixed(4)}`);
    console.log("  Totals for receiver:", counts);
    console.log(
        `\nFE: GET /user/rebate/history (login as ${receiver.username})`
    );
    console.log(
        "  Filters: startDate/endDate, category=LOTTERY|CASINO|SPORTS|RUMMY, settled=true|false, game=WINGO"
    );
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
