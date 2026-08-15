import {
    PrismaClient,
    WithdrawOrderStatus,
} from "../generated/prisma/client";
import { Cache, CacheKey } from "../../cache";

export interface SeedWithdrawalItem {
    amount: number;
    method: "CXPAY" | "XDPAY" | "UPI" | "OXAPAY";
    cryptoChain?: "BEP20" | "TRC20";
    usdtAmount?: number;
    status: WithdrawOrderStatus;
    note?: string;
    daysAgo: number;
    hoursAgo?: number;
    fixedHour?: number;
}

export const SEED_WITHDRAWAL_TEMPLATES: SeedWithdrawalItem[] = [
    // ─── TODAY (All 5 statuses present) ───────────────────────────
    {
        amount: 1500,
        method: "CXPAY",
        status: WithdrawOrderStatus.GENERATED,
        note: "Payout to HDFC Bank (A/C: ••••4821)",
        daysAgo: 0,
        hoursAgo: 1,
    },
    {
        amount: 5000,
        method: "OXAPAY",
        cryptoChain: "BEP20",
        usdtAmount: 50,
        status: WithdrawOrderStatus.PROCESSING,
        note: "USDT withdrawal queued for node broadcast",
        daysAgo: 0,
        hoursAgo: 2,
    },
    {
        amount: 2000,
        method: "UPI",
        status: WithdrawOrderStatus.SUCCESS,
        note: "Fast payout via UPI (paytm@upi)",
        daysAgo: 0,
        hoursAgo: 4,
    },
    {
        amount: 10000,
        method: "XDPAY",
        status: WithdrawOrderStatus.FAILED,
        note: "Gateway error: Beneficiary IFSC inactive",
        daysAgo: 0,
        hoursAgo: 6,
    },
    {
        amount: 3000,
        method: "UPI",
        status: WithdrawOrderStatus.USER_CANCELED,
        note: "User cancelled withdrawal request",
        daysAgo: 0,
        hoursAgo: 8,
    },

    // ─── YESTERDAY (All statuses present) ─────────────────────────
    {
        amount: 4500,
        method: "CXPAY",
        status: WithdrawOrderStatus.SUCCESS,
        note: "Settled to ICICI Bank",
        daysAgo: 1,
        fixedHour: 16,
    },
    {
        amount: 20000,
        method: "OXAPAY",
        cryptoChain: "TRC20",
        usdtAmount: 200,
        status: WithdrawOrderStatus.SUCCESS,
        note: "Settled on Tron Network",
        daysAgo: 1,
        fixedHour: 12,
    },
    {
        amount: 6000,
        method: "CXPAY",
        status: WithdrawOrderStatus.PROCESSING,
        note: "Bank clearance in progress",
        daysAgo: 1,
        fixedHour: 10,
    },
    {
        amount: 8000,
        method: "UPI",
        status: WithdrawOrderStatus.FAILED,
        note: "Bank server unavailable / UPI timeout",
        daysAgo: 1,
        fixedHour: 9,
    },
    {
        amount: 1200,
        method: "CXPAY",
        status: WithdrawOrderStatus.USER_CANCELED,
        note: "User requested cancellation",
        daysAgo: 1,
        fixedHour: 20,
    },

    // ─── EARLIER THIS MONTH ───────────────────────────────────────
    {
        amount: 500,
        method: "UPI",
        status: WithdrawOrderStatus.SUCCESS,
        note: "Instant withdrawal completed",
        daysAgo: 3,
        fixedHour: 14,
    },
    {
        amount: 10000,
        method: "OXAPAY",
        cryptoChain: "BEP20",
        usdtAmount: 100,
        status: WithdrawOrderStatus.SUCCESS,
        note: "Binance Smart Chain payout confirmed",
        daysAgo: 5,
        fixedHour: 11,
    },
    {
        amount: 25000,
        method: "CXPAY",
        status: WithdrawOrderStatus.FAILED,
        note: "Exceeded daily debit limit for bank",
        daysAgo: 7,
        fixedHour: 18,
    },

    // ─── LAST MONTH (July 2026) ───────────────────────────────────
    {
        amount: 3500,
        method: "UPI",
        status: WithdrawOrderStatus.SUCCESS,
        note: "Completed via UPI",
        daysAgo: 25,
        fixedHour: 15,
    },
    {
        amount: 7500,
        method: "OXAPAY",
        cryptoChain: "BEP20",
        usdtAmount: 75,
        status: WithdrawOrderStatus.PROCESSING,
        note: "Settlement processing",
        daysAgo: 26,
        fixedHour: 11,
    },
    {
        amount: 50000,
        method: "OXAPAY",
        cryptoChain: "TRC20",
        usdtAmount: 500,
        status: WithdrawOrderStatus.SUCCESS,
        note: "Large USDT withdrawal settled",
        daysAgo: 28,
        fixedHour: 10,
    },
    {
        amount: 15000,
        method: "XDPAY",
        status: WithdrawOrderStatus.FAILED,
        note: "Bank account name mismatch with KYC",
        daysAgo: 32,
        fixedHour: 17,
    },
    {
        amount: 2500,
        method: "UPI",
        status: WithdrawOrderStatus.USER_CANCELED,
        note: "Cancelled by user",
        daysAgo: 35,
        fixedHour: 13,
    },
];

function makeTimestamp(daysAgo: number, hoursAgo?: number, fixedHour?: number): Date {
    const d = new Date();
    if (daysAgo === 0 && hoursAgo !== undefined) {
        d.setHours(d.getHours() - hoursAgo);
        d.setMinutes(Math.floor(Math.random() * 50) + 5);
        d.setSeconds(Math.floor(Math.random() * 59));
        return d;
    }

    d.setDate(d.getDate() - daysAgo);
    d.setHours(fixedHour ?? 12, Math.floor(Math.random() * 50) + 5, Math.floor(Math.random() * 59));
    return d;
}

function generateSeedOrderId(date: Date, index: number, userSuffix: string): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    const rand = Math.floor(10000000 + Math.random() * 90000000);
    return `${y}${m}${d}-${userSuffix}${String(index).padStart(2, "0")}${rand}`;
}

export async function seedWithdrawals(prisma: PrismaClient, targetUserFilter?: string) {
    console.log("🌱 Seeding withdrawal history across all statuses...");

    let users;
    if (targetUserFilter) {
        users = await prisma.user.findMany({
            where: {
                OR: [
                    { id: targetUserFilter },
                    { mobileNumber: targetUserFilter },
                    { username: targetUserFilter },
                ],
            },
        });
    } else {
        // Find ALL users in DB so every test/demo account has complete withdrawal history
        users = await prisma.user.findMany();
    }

    if (users.length === 0) {
        console.log("⚠️ No users found to seed withdrawals for.");
        return;
    }

    console.log(`Found ${users.length} user(s) to seed withdrawal history for.`);

    const userIds = users.map((u) => u.id);

    // Clean up previous seed withdrawals for all target users in a single query
    const deleted = await prisma.withdraw.deleteMany({
        where: {
            userId: { in: userIds },
            OR: [
                { metadata: { path: ["seed"], equals: true } },
                { note: { contains: "HDFC" } },
                { note: { contains: "USDT" } },
                { note: { contains: "Tron" } },
                { note: { contains: "IFSC" } },
                { note: { contains: "ICICI" } },
                { note: { contains: "UPI timeout" } },
                { note: { contains: "Cancelled" } },
                { note: { contains: "Binance" } },
                { note: { contains: "limit for bank" } },
                { note: { contains: "KYC" } },
            ],
        },
    });
    if (deleted.count > 0) {
        console.log(`  🧹 Cleaned up ${deleted.count} previous seed withdrawals.`);
    }

    const recordsToInsert = [];

    for (const user of users) {
        const userSuffix = user.mobileNumber ? user.mobileNumber.slice(-4) : "0000";

        for (let i = 0; i < SEED_WITHDRAWAL_TEMPLATES.length; i++) {
            const item = SEED_WITHDRAWAL_TEMPLATES[i];
            const date = makeTimestamp(item.daysAgo, item.hoursAgo, item.fixedHour);
            const orderId = generateSeedOrderId(date, i + 1, userSuffix);

            recordsToInsert.push({
                userId: user.id,
                amount: item.amount,
                method: item.method,
                status: item.status,
                orderId,
                note: item.note,
                cryptoChain: item.cryptoChain,
                usdtAmount: item.usdtAmount,
                metadata: {
                    seed: true,
                    seededAt: new Date().toISOString(),
                },
                createdAt: date,
                updatedAt: date,
            });
        }
    }

    // Insert all in a single batch query
    await prisma.withdraw.createMany({
        data: recordsToInsert,
    });

    // Invalidate Redis user caches
    for (const user of users) {
        try {
            await Cache.del(CacheKey.userWithdrawals(user.id));
        } catch {
            // ignore cache errors
        }
    }

    // Invalidate admin cache
    try {
        await Cache.del(CacheKey.adminWithdrawals);
    } catch {
        // ignore cache errors
    }

    console.log(`✅ Successfully seeded ${recordsToInsert.length} withdrawals across all ${users.length} user(s).`);
}
