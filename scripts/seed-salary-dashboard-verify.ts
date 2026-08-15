/**
 * Seed data so Salary Dashboard + Agent Commission show real numbers.
 *
 * Default parent: referral user_9855641885-59967363
 * Override:  PARENT_REF=your-code bun scripts/seed-salary-dashboard-verify.ts
 *
 * Run:  cd backend && bun scripts/seed-salary-dashboard-verify.ts
 */
import { createHash } from "crypto";
import { prisma } from "@bcwin/db";
import {
    computeUserSalaryMetrics,
    formatIstYmd,
    getIstDayRange,
    matchHighestSlab,
} from "../apps/api/src/lib/autoSalaryService";

const PARENT_REF =
    process.env.PARENT_REF?.trim() || "user_9855641885-59967363";
const PREFIX = "sdash_";
const PASSWORD_PLAIN = "Test@1234";

function md5(s: string) {
    return createHash("md5").update(s).digest("hex");
}

function orderId(tag: string) {
    return `SDash-${Date.now()}-${tag}-${Math.floor(Math.random() * 1e9)}`;
}

async function nextSerial(): Promise<number> {
    const max = await prisma.user.aggregate({
        _max: { serialNumber: true },
    });
    return (max._max.serialNumber ?? 8400) + 1;
}

async function main() {
    const parent = await prisma.user.findFirst({
        where: { referralCode: PARENT_REF },
        select: {
            id: true,
            username: true,
            referralCode: true,
            mobileNumber: true,
            balance: true,
        },
    });
    if (!parent) {
        throw new Error(
            `Parent not found referralCode=${PARENT_REF}\n` +
                `Set PARENT_REF to a real user's referral code.`
        );
    }

    console.log("Parent:", parent.username, parent.referralCode, parent.mobileNumber);

    // Clean previous sdash_ users
    const old = await prisma.user.findMany({
        where: { username: { startsWith: PREFIX } },
        select: { id: true },
    });
    if (old.length) {
        const ids = old.map((u) => u.id);
        await prisma.deposit.deleteMany({ where: { userId: { in: ids } } });
        await prisma.commission.deleteMany({
            where: { OR: [{ userId: { in: ids } }, { fromUserId: { in: ids } }] },
        });
        await prisma.dailyCommissionSummary.deleteMany({
            where: { userId: { in: ids } },
        });
        await prisma.user.deleteMany({ where: { id: { in: ids } } });
        console.log("Removed previous sdash_ users:", old.length);
    }

    // Also refresh OLD asal_ seed deposits to today (if still under this parent)
    const asalKids = await prisma.user.findMany({
        where: {
            OR: [
                { referredBy: PARENT_REF, username: { startsWith: "asal_" } },
                {
                    username: { startsWith: "asal_" },
                    // L2 under asal L1 of this parent
                },
            ],
        },
        select: { id: true, referredBy: true, username: true },
    });
    // Collect full asal tree under parent via referral chain is heavy — just touch deposits of any asal_ with SUCCESS SEED
    const asalAll = await prisma.user.findMany({
        where: { username: { startsWith: "asal_" } },
        select: { id: true },
    });
    if (asalAll.length) {
        const now = new Date();
        const upd = await prisma.deposit.updateMany({
            where: {
                userId: { in: asalAll.map((u) => u.id) },
                method: "SEED",
                status: "SUCCESS",
            },
            data: { createdAt: now, updatedAt: now },
        });
        console.log("Bumped asal_ SEED deposits to now:", upd.count);
    }
    void asalKids;

    const password = md5(PASSWORD_PLAIN);
    const stamp = Date.now().toString(36).slice(-5);
    let sn = await nextSerial();

    // ── 6 L1 + 9 L2 with deposits today → hit ₹1,200 slab (6d / 12a / 30k) ──
    const directs: { id: string; referralCode: string; username: string }[] =
        [];
    for (let i = 1; i <= 6; i++) {
        const username = `${PREFIX}d${i}_${stamp}`;
        const u = await prisma.user.create({
            data: {
                serialNumber: sn++,
                username,
                mobileNumber: `91${String(700000000 + i + (Date.now() % 10000)).slice(0, 8)}`,
                password,
                referralCode: `${username}-ref`,
                referredBy: PARENT_REF,
                isDemo: false,
                role: "USER",
                balance: 100,
            },
        });
        directs.push({
            id: u.id,
            referralCode: u.referralCode,
            username: u.username,
        });
    }
    console.log("Created L1:", directs.length);

    const l2Ids: string[] = [];
    let n = 0;
    for (let d = 0; d < 3; d++) {
        const parentCode = directs[d]!.referralCode;
        for (let j = 1; j <= 3; j++) {
            n++;
            const username = `${PREFIX}l2_${d}${j}_${stamp}`;
            const u = await prisma.user.create({
                data: {
                    serialNumber: sn++,
                    username,
                    mobileNumber: `92${String(700000000 + n + (Date.now() % 10000)).slice(0, 8)}`,
                    password,
                    referralCode: `${username}-ref`,
                    referredBy: parentCode,
                    isDemo: false,
                    role: "USER",
                    balance: 50,
                },
            });
            l2Ids.push(u.id);
        }
    }
    console.log("Created L2:", l2Ids.length);

    // Today deposits — ₹30,000 total (slab ₹1,200 needs 6d · 12a · ₹30k)
    const depositors = [...directs.map((d) => d.id), ...l2Ids];
    const targetTotal = 30_000;
    const base = Math.floor(targetTotal / depositors.length);
    let totalDep = 0;
    const now = new Date();
    for (let i = 0; i < depositors.length; i++) {
        const amount =
            i === depositors.length - 1 ? targetTotal - totalDep : base;
        await prisma.deposit.create({
            data: {
                userId: depositors[i]!,
                amount,
                method: "SEED",
                status: "SUCCESS",
                orderId: orderId(`d${i}`),
                createdAt: now,
                updatedAt: now,
            },
        });
        totalDep += amount;
    }
    console.log("Today team deposits ₹", totalDep);

    // Yesterday deposit slice (for YDAY tiles) — ₹4,000 on 3 users
    const yestYmd = (() => {
        const t = formatIstYmd(new Date());
        const { periodDate } = getIstDayRange(t);
        const y = new Date(periodDate.getTime() - 86_400_000);
        return formatIstYmd(y);
    })();
    const { start: yStart } = getIstDayRange(yestYmd);
    // mid-day yesterday
    const yMid = new Date(yStart.getTime() + 12 * 3600_000);
    for (let i = 0; i < 3; i++) {
        await prisma.deposit.create({
            data: {
                userId: depositors[i]!,
                amount: 1_500,
                method: "SEED",
                status: "SUCCESS",
                orderId: orderId(`y${i}`),
                createdAt: yMid,
                updatedAt: yMid,
            },
        });
    }
    console.log("Yesterday deposits ₹", 4500);

    // ── Salary history (rule + payments) ───────────────────────
    await prisma.salaryPayment.deleteMany({
        where: {
            userId: parent.id,
            salaryRule: { userId: parent.id, frequency: "DAILY" },
        },
    });
    await prisma.salaryRule.deleteMany({
        where: { userId: parent.id, frequency: "DAILY", isActive: false },
    });

    const rule = await prisma.salaryRule.create({
        data: {
            userId: parent.id,
            amount: 300,
            frequency: "DAILY",
            maxPayments: 30,
            paidCount: 2,
            startDate: new Date(Date.now() - 7 * 86_400_000),
            nextPaymentAt: new Date(Date.now() + 86_400_000),
            immediateFirst: false,
            addToTurnover: false,
            isActive: false, // seed-only history; not for live scheduler spam
        },
    });
    await prisma.salaryPayment.createMany({
        data: [
            {
                salaryRuleId: rule.id,
                userId: parent.id,
                amount: 300,
                createdAt: new Date(Date.now() - 2 * 86_400_000),
            },
            {
                salaryRuleId: rule.id,
                userId: parent.id,
                amount: 500,
                createdAt: new Date(Date.now() - 1 * 86_400_000),
            },
        ],
    });
    console.log("Salary history: 2 payments (₹300 + ₹500)");

    // ── Commission samples for agent dashboard ─────────────────
    const todayYmd = formatIstYmd(new Date());
    const { periodDate: todayPeriod } = getIstDayRange(todayYmd);
    // truncate for daily summary unique
    await prisma.dailyCommissionSummary.upsert({
        where: {
            userId_date: { userId: parent.id, date: todayPeriod },
        },
        create: {
            userId: parent.id,
            date: todayPeriod,
            totalCommission: 128.5,
            layer1Commission: 90,
            layer2Commission: 25,
            layer3Commission: 8,
            layer4Commission: 3.5,
            layer5Commission: 1.5,
            layer6Commission: 0.5,
        },
        update: {
            totalCommission: 128.5,
            layer1Commission: 90,
            layer2Commission: 25,
            layer3Commission: 8,
            layer4Commission: 3.5,
            layer5Commission: 1.5,
            layer6Commission: 0.5,
        },
    });

    // a few commission detail rows
    await prisma.commission.deleteMany({
        where: {
            userId: parent.id,
            betType: "SEED",
        },
    });
    for (let i = 0; i < 6; i++) {
        const from = depositors[i % depositors.length]!;
        await prisma.commission.create({
            data: {
                userId: parent.id,
                fromUserId: from,
                layer: (i % 3) + 1,
                userVipLevel: 0,
                commissionRate: 0.006,
                betAmount: 500 + i * 100,
                commissionAmount: 3 + i * 0.5,
                betType: "SEED",
                betId: orderId(`bet${i}`),
                calculationDate: todayPeriod,
            },
        });
    }
    console.log("Commission: daily summary + 6 detail rows");

    // Clear salary dashboard cache if redis available (best-effort)
    try {
        const { Cache } = await import("@bcwin/cache");
        await Cache.del(`user:salary-dashboard:${parent.id}`);
        console.log("Cleared salary dashboard cache");
    } catch {
        /* ignore */
    }

    // ── Verify metrics ─────────────────────────────────────────
    const { start, end } = getIstDayRange(todayYmd);
    const metrics = await computeUserSalaryMetrics(parent.id, start, end);
    const match = matchHighestSlab(metrics);

    console.log("\n========== SEED READY ==========");
    console.log("Login as parent:");
    console.log("  mobile:", parent.mobileNumber);
    console.log("  referralCode:", parent.referralCode);
    console.log("Today IST:", todayYmd);
    console.log("Metrics:", metrics);
    console.log(
        "Matched slab:",
        match
            ? `₹${match.amount} (index ${match.slabIndex})`
            : "none — need more direct/active/deposit"
    );
    console.log("Seed downline password:", PASSWORD_PLAIN, `(usernames ${PREFIX}*)`);
    console.log("\nOpen app → Promotion → Salary dashboard / Agent commission");
    console.log("If dashboard still zeros: restart API & hard-refresh.");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
