/**
 * Daily rebate level + 24:00 Agent commission close (ADR-0036).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "@bcwin/db";
import {
    DailyTeamRebate,
    istDayRange,
    ymdIst,
} from "../../packages/rebate/dailyTeamRebate";
import {
    FixtureTracker,
    createTestUser,
    createWingoPeriod,
    cleanupByUserIds,
    ensureSystemConfig,
    post,
    authCookieFor,
} from "../helpers";

describe("Daily team rebate (ADR-0036)", () => {
    const tracker = new FixtureTracker("dtr");
    const today = ymdIst();
    const range = istDayRange(today);

    let parent: Awaited<ReturnType<typeof createTestUser>>;
    let l1s: Awaited<ReturnType<typeof createTestUser>>[] = [];
    let periodId: string;

    beforeAll(async () => {
        await ensureSystemConfig();
        parent = await createTestUser(tracker, { balance: 0 });
        const period = await createWingoPeriod(tracker, {
            startTime: new Date(),
        });
        periodId = period.id;

        await prisma.vipLevelRequirement.upsert({
            where: { level: 1 },
            create: {
                level: 1,
                expRequired: 1,
                teamSize: 10,
                teamBetting: 50_000,
                teamDeposit: 10_000,
            },
            update: {
                teamSize: 10,
                teamBetting: 50_000,
                teamDeposit: 10_000,
            },
        });

        for (let i = 0; i < 10; i++) {
            const u = await createTestUser(tracker, {
                balance: 20_000,
                referredBy: parent.referralCode,
            });
            l1s.push(u);
            await prisma.user.update({
                where: { id: u.id },
                data: { createdAt: new Date(range.gte.getTime() + 3600_000) },
            });
            await prisma.deposit.create({
                data: {
                    orderId: `${tracker.orderPrefix}d${i}`,
                    amount: 1000,
                    method: "UPI",
                    status: "SUCCESS",
                    userId: u.id,
                    createdAt: new Date(range.gte.getTime() + 2 * 3600_000),
                },
            });
            await prisma.wingoBet.create({
                data: {
                    userId: u.id,
                    periodId,
                    betAmount: 5000,
                    contractAmount: 4900,
                    betType: "COLOR",
                    betChoice: "RED",
                    createdAt: new Date(range.gte.getTime() + 3 * 3600_000),
                },
            });
        }

        await prisma.userVipLevel.upsert({
            where: { userId: parent.id },
            create: {
                userId: parent.id,
                currentLevel: 0,
                rebateLevel: 4,
                teamSize: 0,
                teamBetting: 0,
                teamDeposit: 0,
            },
            update: { rebateLevel: 4 },
        });
    });

    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
            giftCodePrefix: tracker.giftPrefix,
            orderIdPrefix: tracker.orderPrefix,
        });
    });

    test("today-so-far metrics qualify L1 (10 new / ₹50k bet / ₹10k deposit)", async () => {
        const m = await DailyTeamRebate.metricsForDay(parent.id, range);
        expect(m.teamSize).toBe(10);
        expect(m.teamBetting).toBe(50_000);
        expect(m.teamDeposit).toBe(10_000);
        expect(await DailyTeamRebate.qualifyLevel(m)).toBeGreaterThanOrEqual(1);
    });

    test("preview uses that level and is not in wallet yet", async () => {
        const p = await DailyTeamRebate.previewForUser(parent.id, today);
        expect(p.rebateLevel).toBeGreaterThanOrEqual(1);
        expect(p.totalCommission).toBeGreaterThan(0);
        expect(p.people.length).toBe(10);
        const peopleSum = p.people.reduce((s, x) => s + x.commission, 0);
        expect(peopleSum).toBeCloseTo(p.totalCommission, 3);
        const u = await prisma.user.findUnique({ where: { id: parent.id } });
        expect(Number(u?.balance ?? 0)).toBe(0);
    });

    test("close job credits once, stamps TX day, then rebateLevel is 0", async () => {
        const before = await prisma.user.findUnique({
            where: { id: parent.id },
        });
        expect(Number(before?.balance ?? 0)).toBe(0);

        const r1 = await DailyTeamRebate.processClosedIstDay(today);
        expect(r1.created).toBeGreaterThan(0);

        const after = await prisma.user.findUnique({
            where: { id: parent.id },
        });
        expect(Number(after?.balance ?? 0)).toBeGreaterThan(0);

        const rows = await prisma.rebate.findMany({
            where: { userId: parent.id },
        });
        expect(rows.every((x) => x.settled)).toBe(true);
        expect(rows.every((x) => (x.receiverVip ?? 0) >= 1)).toBe(true);
        expect(
            rows.every(
                (x) => x.createdAt >= range.gte && x.createdAt < range.lt
            )
        ).toBe(true);

        const vip = await prisma.userVipLevel.findUnique({
            where: { userId: parent.id },
        });
        expect(vip?.rebateLevel).toBe(0);

        const r2 = await DailyTeamRebate.processClosedIstDay(today);
        expect(r2.created).toBe(0);
        const after2 = await prisma.user.findUnique({
            where: { id: parent.id },
        });
        expect(Number(after2?.balance ?? 0)).toBe(Number(after?.balance ?? 0));
    });

    test("placing a bet does not write team rebate rows", async () => {
        const cookie = await authCookieFor(l1s[0]!);
        const before = await prisma.rebate.count({
            where: { fromUserId: l1s[0]!.id, settled: false },
        });
        await post("/api/v1/wingo/bet", {
            cookie,
            json: {
                periodId,
                betAmount: 10,
                betType: "COLOR",
                betChoice: "RED",
            },
        }).catch(() => null);
        const after = await prisma.rebate.count({
            where: { fromUserId: l1s[0]!.id, settled: false },
        });
        expect(after).toBe(before);
    });

    test("Inout bets use catalog category (not default SLOTS)", async () => {
        const mode = `${tracker.runId}_casino`;
        await prisma.inoutGame.create({
            data: {
                title: "Test casino",
                gameMode: mode,
                description: "t",
                category: "live casino",
                icon: "x",
                multiplayer: false,
                rtp: 96,
            },
        });
        const bettor = l1s[0]!;
        const bet = await prisma.inoutBet.create({
            data: {
                userId: bettor.id,
                token: bettor.id,
                gameMode: mode,
                betAmount: 100,
                currency: "INR",
                operator: "test",
                transactionId: `${tracker.orderPrefix}io1`,
                gameId: "g1",
                winAmount: 0,
                createdAt: new Date(range.gte.getTime() + 4 * 3600_000),
            },
        });
        await DailyTeamRebate.processClosedIstDay(today);
        const row = await prisma.rebate.findFirst({
            where: { userId: parent.id, betId: bet.id },
        });
        expect(row?.gameCategory).toBe("CASINO");
        await prisma.inoutBet.delete({ where: { id: bet.id } });
        await prisma.inoutGame.deleteMany({ where: { gameMode: mode } });
    });
});
