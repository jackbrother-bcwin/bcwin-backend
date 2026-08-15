/**
 * One-off seed: build team under referral user_9855641885-59967363
 * so auto salary slabs can be tested (Generate → Approve).
 *
 * Run:  cd backend && bun scripts/seed-auto-salary-test.ts
 *
 * Creates non-demo L1 + L2 with SUCCESS deposits today (IST).
 * Also creates one DEMO L1 with a large deposit (must not count).
 */
import { createHash } from "crypto";
import { prisma } from "@bcwin/db";

const PARENT_REF = "user_9855641885-59967363";
const PREFIX = "asal_";
const PASSWORD_PLAIN = "Test@1234";

function md5(s: string) {
    return createHash("md5").update(s).digest("hex");
}

function orderId(tag: string) {
    const d = new Date();
    const day =
        d.getUTCFullYear().toString() +
        String(d.getUTCMonth() + 1).padStart(2, "0") +
        String(d.getUTCDate()).padStart(2, "0");
    return `${day}-ASAL-${tag}-${Math.floor(Math.random() * 1e12)}`;
}

/** Unique 10-digit mobile for seeds */
function mobile(n: number) {
    return `9${String(800000000 + n).slice(0, 9)}`;
}

async function main() {
    const parent = await prisma.user.findFirst({
        where: { referralCode: PARENT_REF },
        select: {
            id: true,
            username: true,
            referralCode: true,
            balance: true,
            isDemo: true,
        },
    });
    if (!parent) {
        throw new Error(`Parent not found referralCode=${PARENT_REF}`);
    }
    console.log(
        "Parent:",
        parent.username,
        parent.referralCode,
        "balance",
        parent.balance
    );

    // Remove previous seed users
    const old = await prisma.user.findMany({
        where: { username: { startsWith: PREFIX } },
        select: { id: true },
    });
    if (old.length) {
        const ids = old.map((u) => u.id);
        await prisma.deposit.deleteMany({ where: { userId: { in: ids } } });
        await prisma.autoSalaryClaim
            .deleteMany({ where: { userId: { in: ids } } })
            .catch(() => undefined);
        await prisma.user.deleteMany({ where: { id: { in: ids } } });
        console.log("Removed previous seed users:", old.length);
    }

    const password = md5(PASSWORD_PLAIN);
    const stamp = Date.now().toString(36).slice(-5);

    // ── 6 direct (L1) non-demo ─────────────────────────────────
    const directs: { id: string; referralCode: string; username: string }[] =
        [];
    for (let i = 1; i <= 6; i++) {
        const username = `${PREFIX}d${i}_${stamp}`;
        const u = await prisma.user.create({
            data: {
                username,
                mobileNumber: mobile(1000 + i),
                password,
                referralCode: `${username}-ref`,
                referredBy: PARENT_REF,
                isDemo: false,
                role: "USER",
                balance: 50,
            },
        });
        directs.push({
            id: u.id,
            referralCode: u.referralCode,
            username: u.username,
        });
        console.log("  L1", u.username, u.mobileNumber);
    }

    // ── 1 demo L1 (must not count) ─────────────────────────────
    const demo = await prisma.user.create({
        data: {
            username: `${PREFIX}demo_${stamp}`,
            mobileNumber: mobile(1999),
            password,
            referralCode: `${PREFIX}demo-${stamp}-ref`,
            referredBy: PARENT_REF,
            isDemo: true,
            role: "USER",
            balance: 0,
        },
    });
    await prisma.deposit.create({
        data: {
            userId: demo.id,
            amount: 99_999,
            method: "SEED",
            status: "SUCCESS",
            orderId: orderId("demo"),
        },
    });
    console.log("  L1 DEMO (excluded)", demo.username, "+ ₹99999 deposit");

    // ── 9 L2 (3 under first 3 directs) ─────────────────────────
    const l2Ids: string[] = [];
    let n = 0;
    for (let d = 0; d < 3; d++) {
        const parentCode = directs[d]!.referralCode;
        for (let j = 1; j <= 3; j++) {
            n++;
            const username = `${PREFIX}l2_${d}${j}_${stamp}`;
            const u = await prisma.user.create({
                data: {
                    username,
                    mobileNumber: mobile(2000 + n),
                    password,
                    referralCode: `${username}-ref`,
                    referredBy: parentCode,
                    isDemo: false,
                    role: "USER",
                    balance: 20,
                },
            });
            l2Ids.push(u.id);
        }
    }
    console.log("  L2 count", l2Ids.length);

    // ── SUCCESS deposits now (counts as today's IST team deposit) ─
    // Target ≥ ₹30,000 team deposit (₹1,200 row). Active now = lottery bet ≥₹150,
    // not deposit: 4 active L1 + 18 total actives required. Add bets before Generate.
    const depositors = [...directs.map((d) => d.id), ...l2Ids];
    const targetTotal = 30_000;
    const base = Math.floor(targetTotal / depositors.length);
    let totalDep = 0;
    for (let i = 0; i < depositors.length; i++) {
        const amount =
            i === depositors.length - 1
                ? targetTotal - totalDep
                : base;
        await prisma.deposit.create({
            data: {
                userId: depositors[i]!,
                amount,
                method: "SEED",
                status: "SUCCESS",
                orderId: orderId(`u${i}`),
            },
        });
        totalDep += amount;
    }
    console.log("  Team deposits (non-demo) total ₹", totalDep);

    // ── Verify ─────────────────────────────────────────────────
    const directCount = await prisma.user.count({
        where: { referredBy: PARENT_REF, isDemo: false },
    });
    const demoDirect = await prisma.user.count({
        where: { referredBy: PARENT_REF, isDemo: true },
    });

    console.log("\n========== SEED READY ==========");
    console.log("Promotion / referral code:", PARENT_REF);
    console.log("Direct non-demo:", directCount, "(demo directs:", demoDirect + ")");
    console.log("Active (approx):", depositors.length, "users with SUCCESS deposit");
    console.log("Team deposit today (approx): ₹", totalDep);
    console.log(
        "Expected ₹1,200 only if 4+ L1 and 18+ team members each bet ≥₹150 in 24h, plus ₹30k deposit."
    );
    console.log("Seed user password:", PASSWORD_PLAIN);
    console.log("Seed username prefix:", PREFIX);
    console.log("\nNext: Admin → Salary → Auto slabs → pick today → Generate → Approve");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
