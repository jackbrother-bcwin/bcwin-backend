/**
 * Seed a compact L1-L6 team for the user Salary business report.
 *
 * Default parent: referral user_9855641885-59967363
 * Override: PARENT_REF=your-code bun --env-file .env scripts/seed-salary-business-report.ts
 *
 * The seed is repeatable: only users whose username starts with `sbiz_` are
 * replaced. Automatic-salary claims, salary rules, commissions, and balances
 * are not changed.
 */
import { createHash } from "crypto";

import { Cache } from "@bcwin/cache";
import { prisma } from "@bcwin/db";

import {
    formatIstYmd,
    getIstDayRange,
} from "../apps/api/src/lib/autoSalaryService";
import {
    computeAnalysisCore,
    decorateLeg,
} from "../apps/api/src/routes/admin/users/teamDayAnalysis";

const PARENT_REF =
    process.env.PARENT_REF?.trim() || "user_9855641885-59967363";
const PREFIX = "sbiz_";
const PASSWORD = createHash("md5").update("Test@1234").digest("hex");

async function nextSerial(): Promise<number> {
    const result = await prisma.user.aggregate({
        _max: { serialNumber: true },
    });
    return (result._max.serialNumber ?? 8400) + 1;
}

function previousIstDay(ymd: string): string {
    const { periodDate } = getIstDayRange(ymd);
    return formatIstYmd(new Date(periodDate.getTime() - 86_400_000));
}

async function main() {
    const parent = await prisma.user.findUnique({
        where: { referralCode: PARENT_REF },
        select: {
            id: true,
            username: true,
            mobileNumber: true,
            referralCode: true,
            isDemo: true,
        },
    });
    if (!parent) {
        throw new Error(
            `Parent not found for referralCode=${PARENT_REF}. Set PARENT_REF to the user you want to inspect.`
        );
    }

    const oldUsers = await prisma.user.findMany({
        where: { username: { startsWith: PREFIX } },
        select: { id: true },
    });
    if (oldUsers.length > 0) {
        await prisma.user.deleteMany({
            where: { id: { in: oldUsers.map((user) => user.id) } },
        });
    }

    const stamp = Date.now().toString(36).slice(-6);
    const mobileSeed = Number(String(Date.now()).slice(-7));
    let serialNumber = await nextSerial();
    let userNumber = 0;

    const createMember = async (
        label: string,
        referredBy: string
    ) => {
        userNumber += 1;
        const username = `${PREFIX}${label}_${stamp}`;
        return prisma.user.create({
            data: {
                serialNumber: serialNumber++,
                username,
                mobileNumber: `93${String(mobileSeed + userNumber).padStart(8, "0").slice(-8)}`,
                password: PASSWORD,
                referralCode: `${username}_ref`,
                referredBy,
                isDemo: false,
                role: "USER",
                balance: 100,
            },
            select: {
                id: true,
                username: true,
                serialNumber: true,
                referralCode: true,
            },
        });
    };

    const a = await createMember("a", parent.referralCode);
    const b = await createMember("b", parent.referralCode);
    const c = await createMember("c", parent.referralCode);
    const d = await createMember("d", parent.referralCode);
    const l2 = await createMember("a_l2", a.referralCode);
    const l3 = await createMember("a_l3", l2.referralCode);
    const l4 = await createMember("a_l4", l3.referralCode);
    const l5 = await createMember("a_l5", l4.referralCode);
    const l6 = await createMember("a_l6", l5.referralCode);

    const today = formatIstYmd(new Date());
    const yesterday = previousIstDay(today);
    const yesterdayAt = new Date(
        getIstDayRange(yesterday).start.getTime() + 12 * 3_600_000
    );
    const todayAt = new Date();
    const seedMetadata = {
        seed: "salary-business-report",
        parentId: parent.id,
    };

    const todayDeposits = [
        [a.id, 10_000, "a"],
        [b.id, 25_000, "b"],
        [c.id, 25_000, "c"],
        [l2.id, 10_000, "a-l2"],
        [l3.id, 10_000, "a-l3"],
        [l4.id, 10_000, "a-l4"],
        [l5.id, 5_000, "a-l5"],
        [l6.id, 5_000, "a-l6"],
    ] as const;
    const todayWithdrawals = [
        [a.id, 5_000, "a"],
        [b.id, 35_000, "b"],
        [c.id, 45_000, "c"],
        [l2.id, 3_000, "a-l2"],
        [l3.id, 3_000, "a-l3"],
        [l4.id, 3_000, "a-l4"],
        [l5.id, 3_000, "a-l5"],
        [l6.id, 3_000, "a-l6"],
    ] as const;
    const yesterdayDeposits = [
        [a.id, 5_000, "a"],
        [b.id, 40_000, "b"],
        [c.id, 20_000, "c"],
        [l2.id, 3_000, "a-l2"],
        [l3.id, 3_000, "a-l3"],
        [l4.id, 3_000, "a-l4"],
        [l5.id, 3_000, "a-l5"],
        [l6.id, 3_000, "a-l6"],
    ] as const;
    const yesterdayWithdrawals = [
        [a.id, 10_000, "a"],
        [b.id, 10_000, "b"],
        [c.id, 20_000, "c"],
        [l2.id, 8_000, "a-l2"],
        [l3.id, 8_000, "a-l3"],
        [l4.id, 8_000, "a-l4"],
        [l5.id, 8_000, "a-l5"],
        [l6.id, 8_000, "a-l6"],
    ] as const;

    const deposits = [
        ...todayDeposits.map(([userId, amount, tag]) => ({
            userId,
            amount,
            tag: `today-${tag}`,
            createdAt: todayAt,
        })),
        ...yesterdayDeposits.map(([userId, amount, tag]) => ({
            userId,
            amount,
            tag: `yesterday-${tag}`,
            createdAt: yesterdayAt,
        })),
    ];
    const withdrawals = [
        ...todayWithdrawals.map(([userId, amount, tag]) => ({
            userId,
            amount,
            tag: `today-${tag}`,
            createdAt: todayAt,
        })),
        ...yesterdayWithdrawals.map(([userId, amount, tag]) => ({
            userId,
            amount,
            tag: `yesterday-${tag}`,
            createdAt: yesterdayAt,
        })),
    ];

    await prisma.$transaction([
        prisma.deposit.createMany({
            data: deposits.map((row) => ({
                userId: row.userId,
                amount: row.amount,
                method: "SEED",
                status: "SUCCESS",
                orderId: `SBIZ-D-${stamp}-${row.tag}`,
                metadata: seedMetadata,
                createdAt: row.createdAt,
                updatedAt: row.createdAt,
            })),
        }),
        prisma.withdraw.createMany({
            data: withdrawals.map((row) => ({
                userId: row.userId,
                amount: row.amount,
                method: "SEED",
                status: "SUCCESS",
                orderId: `SBIZ-W-${stamp}-${row.tag}`,
                metadata: seedMetadata,
                createdAt: row.createdAt,
                updatedAt: row.createdAt,
            })),
        }),
    ]);

    await Promise.all([
        Cache.del(`user:salary-business-report:v1:${parent.id}:${today}`),
        Cache.del(`user:salary-business-report:v1:${parent.id}:${yesterday}`),
    ]);

    const sum = (rows: ReadonlyArray<readonly [string, number, string]>) =>
        rows.reduce((total, row) => total + row[1], 0);
    const [todayCore, yesterdayCore] = await Promise.all([
        computeAnalysisCore(parent, today, false),
        computeAnalysisCore(parent, yesterday, false),
    ]);
    const expectedToday = {
        deposit: sum(todayDeposits),
        withdrawal: sum(todayWithdrawals),
    };
    const expectedYesterday = {
        deposit: sum(yesterdayDeposits),
        withdrawal: sum(yesterdayWithdrawals),
    };
    if (
        todayCore.team.deposit.amount !== expectedToday.deposit ||
        todayCore.team.withdrawal.amount !== expectedToday.withdrawal ||
        yesterdayCore.team.deposit.amount !== expectedYesterday.deposit ||
        yesterdayCore.team.withdrawal.amount !== expectedYesterday.withdrawal
    ) {
        throw new Error("Seed verification failed: computed report totals differ");
    }
    const contribution = (core: typeof todayCore) =>
        core.legs
            .map((leg) => decorateLeg(leg, core.team))
            .map(
                (leg) =>
                    `${leg.username}: D ${leg.deposit.share.toFixed(0)}% / W ${leg.withdrawal.share.toFixed(0)}%`
            )
            .join(" | ");

    console.log("\nSalary business report seed ready");
    console.log("Parent username:", parent.username);
    console.log("Parent mobile:", parent.mobileNumber);
    console.log("Parent referral:", parent.referralCode);
    console.log(
        `Today ${today}: deposit ₹${expectedToday.deposit}, withdrawal ₹${expectedToday.withdrawal}`
    );
    console.log("Today shares:", contribution(todayCore));
    console.log(
        `Yesterday ${yesterday}: deposit ₹${expectedYesterday.deposit}, withdrawal ₹${expectedYesterday.withdrawal}`
    );
    console.log("Yesterday shares:", contribution(yesterdayCore));
    console.log(
        "L1 legs:",
        [a, b, c, d]
            .map((user) => `${user.username} (#${user.serialNumber})`)
            .join(", ")
    );
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await Cache.disconnect().catch(() => undefined);
        await prisma.$disconnect();
    });
