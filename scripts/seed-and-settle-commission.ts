/**
 * Seed & Settle Local Database Script for Commission Details & Scheduler Verification.
 * 
 * Usage:
 *   1. Seed unsettled rebates:
 *      cd backend && bun --env-file .env scripts/seed-and-settle-commission.ts
 * 
 *   2. Settle via scheduler:
 *      cd backend && bun --env-file .env scripts/seed-and-settle-commission.ts --settle
 */

import { createHash } from "crypto";
import { prisma } from "@bcwin/db";
import { RebateCalculator } from "@bcwin/rebate";
import { seedRebateRates } from "../packages/db/seeds/rebateRates";
import { RebateScheduler } from "../apps/engine/src/scheduler/rebateScheduler";

const AGENT_USERNAME = "test_agent_01";
const AGENT_MOBILE = "9988776655";
const AGENT_REF_CODE = "REF_AGENT_01";
const AGENT_PASSWORD_PLAIN = "Password123!";

function md5(s: string): string {
    return createHash("md5").update(s).digest("hex");
}

function getTodayIstYmd(): string {
    const d = new Date();
    const istMs = d.getTime() + 5.5 * 60 * 60 * 1000;
    const ist = new Date(istMs);
    const y = ist.getUTCFullYear();
    const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
    const day = String(ist.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

async function nextSerial(): Promise<number> {
    const max = await prisma.user.aggregate({
        _max: { serialNumber: true },
    });
    return (max._max.serialNumber ?? 8800) + 1;
}

async function main() {
    const shouldSettle = process.argv.includes("--settle");

    console.log("\n=======================================================");
    console.log(" 🚀 SEED & SETTLE COMMISSION DETAILS DEMO SCRIPT");
    console.log("=======================================================\n");

    // 1. Ensure RebateRateConfig is seeded
    console.log("1. Ensuring RebateRateConfig is seeded in DB...");
    await seedRebateRates(prisma);

    // 2. Find or create Primary Agent User
    let agent = await prisma.user.findFirst({
        where: { OR: [{ username: AGENT_USERNAME }, { mobileNumber: AGENT_MOBILE }] },
    });

    if (!agent) {
        const serial = await nextSerial();
        agent = await prisma.user.create({
            data: {
                serialNumber: serial,
                username: AGENT_USERNAME,
                mobileNumber: AGENT_MOBILE,
                password: md5(AGENT_PASSWORD_PLAIN),
                referralCode: AGENT_REF_CODE,
                balance: 1000,
                role: "USER",
            },
        });
        console.log(`✅ Created Primary Agent: ${agent.username} (Mobile: ${agent.mobileNumber})`);
    } else {
        console.log(`ℹ️  Found Existing Agent: ${agent.username} (Mobile: ${agent.mobileNumber}, Balance: ₹${agent.balance.toFixed(2)})`);
    }

    // Set VIP Level 3 for Agent
    await prisma.userVipLevel.upsert({
        where: { userId: agent.id },
        create: {
            userId: agent.id,
            currentLevel: 3,
            teamSize: 12,
            teamBetting: 150000,
            teamDeposit: 50000,
        },
        update: { currentLevel: 3, teamSize: 12 },
    });

    // 3. Downlines creation
    const downlineDefs = [
        { name: "downline_l1_alpha", layer: 1, parentRef: agent.referralCode },
        { name: "downline_l1_beta", layer: 1, parentRef: agent.referralCode },
        { name: "downline_l2_gamma", layer: 2, parentRef: "REF_L1_ALPHA" },
        { name: "downline_l3_delta", layer: 3, parentRef: "REF_L2_GAMMA" },
        { name: "downline_l6_omega", layer: 6, parentRef: "REF_L5_EPSILON" },
    ];

    const downlineUsers: Record<string, any> = {};

    for (const def of downlineDefs) {
        let u = await prisma.user.findFirst({
            where: { username: def.name },
        });
        if (!u) {
            const serial = await nextSerial();
            const refCode = `REF_${def.name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
            u = await prisma.user.create({
                data: {
                    serialNumber: serial,
                    username: def.name,
                    mobileNumber: `987${String(Math.floor(Math.random() * 10000000)).padStart(7, "0")}`,
                    password: md5("Password123!"),
                    referralCode: refCode,
                    referredBy: def.parentRef,
                    balance: 5000,
                },
            });
        }
        downlineUsers[def.name] = u;
    }

    if (!shouldSettle) {
        // Clear previous seed rebates for this agent to give a clean state
        await prisma.rebate.deleteMany({
            where: { userId: agent.id },
        });
        console.log("🧹 Cleaned previous rebates for agent.\n");

        console.log("2. Accruing realistic downline bets and team rebates...");

        const betsToSimulate = [
            // Today's bets
            { downline: downlineUsers["downline_l1_alpha"], game: "WINGO", category: "LOTTERY", betAmount: 5000, layer: 1 },
            { downline: downlineUsers["downline_l1_alpha"], game: "K3", category: "LOTTERY", betAmount: 3000, layer: 1 },
            { downline: downlineUsers["downline_l1_beta"], game: "INOUT", category: "SLOTS", betAmount: 8000, layer: 1 },
            { downline: downlineUsers["downline_l2_gamma"], game: "INOUT", category: "CASINO", betAmount: 12000, layer: 2 },
            { downline: downlineUsers["downline_l3_delta"], game: "INOUT", category: "SPORTS", betAmount: 15000, layer: 3 },
            { downline: downlineUsers["downline_l6_omega"], game: "5D", category: "LOTTERY", betAmount: 20000, layer: 6 },
        ];

        let totalAccruedRebate = 0;
        let count = 0;

        for (const b of betsToSimulate) {
            const date = new Date();
            // Manually insert rebate rows to ensure exact attributes for demo
            const rate = b.category === "LOTTERY" ? (b.layer === 1 ? 0.75 : b.layer === 2 ? 0.3375 : 0.05) : (b.layer === 1 ? 0.45 : 0.15);
            const amount = b.betAmount * (rate / 100);

            await prisma.rebate.create({
                data: {
                    userId: agent.id,
                    fromUserId: b.downline.id,
                    amount,
                    game: b.game,
                    gameCategory: b.category as any,
                    layer: b.layer,
                    receiverVip: 3,
                    rate,
                    betAmount: b.betAmount,
                    betId: `demo-bet-${++count}-${Date.now()}`,
                    settled: false,
                    createdAt: date,
                },
            });
            totalAccruedRebate += amount;
            console.log(`   + Accrued L${b.layer} ${b.category.padEnd(8)} from ${b.downline.username.padEnd(20)}: Bet ₹${b.betAmount} → Rebate ₹${amount.toFixed(2)} (${rate}%)`);
        }

        console.log(`\n📊 UNSETTLED STATE SUMMARY FOR AGENT (${agent.username}):`);
        console.log(`   - Account Balance:      ₹${agent.balance.toFixed(2)}`);
        console.log(`   - Pending Rebate Rows:  ${count}`);
        console.log(`   - Total Pending Payout: ₹${totalAccruedRebate.toFixed(2)}`);
        console.log(`   - Settlement Status:    PENDING (settled = false)\n`);

        console.log("-------------------------------------------------------");
        console.log(" 👉 TO SETTLE THESE COMMISSIONS USING THE SCHEDULER:");
        console.log("    Run command:");
        console.log("    cd backend && bun --env-file .env scripts/seed-and-settle-commission.ts --settle");
        console.log("-------------------------------------------------------\n");

    } else {
        // Settle Mode
        const unsettledBefore = await prisma.rebate.findMany({
            where: { userId: agent.id, settled: false },
        });

        const pendingAmount = unsettledBefore.reduce((sum, r) => sum + r.amount, 0);

        console.log(`2. Executing 01:30 AM IST Rebate Settlement Scheduler...`);
        console.log(`   - Pending Rebates: ${unsettledBefore.length} rows`);
        console.log(`   - Total Amount:    ₹${pendingAmount.toFixed(2)}`);

        // Run manual trigger on RebateScheduler
        const scheduler = new RebateScheduler();
        await scheduler.runManualSettlement();

        const updatedAgent = await prisma.user.findUnique({
            where: { id: agent.id },
            select: { balance: true, username: true },
        });

        const settledAfter = await prisma.rebate.findMany({
            where: { userId: agent.id, settled: true },
        });

        console.log(`\n✅ SETTLEMENT COMPLETE!`);
        console.log(`=======================================================`);
        console.log(` 👤 Agent Username:   ${updatedAgent?.username}`);
        console.log(` 📱 Mobile Number:   ${AGENT_MOBILE}`);
        console.log(` 🔑 Password:        ${AGENT_PASSWORD_PLAIN}`);
        console.log(` 💰 Balance Before:   ₹${agent.balance.toFixed(2)}`);
        console.log(` ➕ Credited Amount:  ₹${pendingAmount.toFixed(2)}`);
        console.log(` 💳 Balance After:    ₹${updatedAgent?.balance.toFixed(2)}`);
        console.log(` 📄 Settled Rows:     ${settledAfter.length}`);
        console.log(`=======================================================\n`);

        console.log("📱 HOW TO VERIFY IN YOUR BROWSER:");
        console.log(" 1. Open: http://localhost:3002");
        console.log(` 2. Login with Mobile: ${AGENT_MOBILE} | Password: ${AGENT_PASSWORD_PLAIN}`);
        console.log(" 3. Go to: Promotion → Commission Details");
        console.log(" 4. Observe:");
        console.log("    • Status: 'Settlement successful'");
        console.log(`    • Commission Payout: ₹${pendingAmount.toFixed(3)}`);
        console.log("    • Key-value table showing Bettors, Bet Amount, Date & Time");
        console.log("    • Click the card to open activity breakdown by level & user!");
        console.log("\n");
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
