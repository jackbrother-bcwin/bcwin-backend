/**
 * Deploy-day catch-up must close YESTERDAY only, never the live IST day.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@bcwin/db";
import {
    DailyTeamRebate,
    istDayRange,
    shiftYmdIst,
    ymdIst,
} from "../../packages/rebate/dailyTeamRebate";
import {
    FixtureTracker,
    cleanupByUserIds,
    createTestUser,
    createWingoPeriod,
    ensureSystemConfig,
} from "../helpers";

describe("Catch-up closes yesterday only (never today)", () => {
    test("6 Sep IST catch-up target is 5 Sep, not 6 Sep", () => {
        expect(shiftYmdIst("2026-09-06", -1)).toBe("2026-09-05");
        expect(shiftYmdIst("2026-09-06", -1)).not.toBe("2026-09-06");

        const sep5 = istDayRange("2026-09-05");
        const sep6 = istDayRange("2026-09-06");
        expect(sep5.lt.getTime()).toBe(sep6.gte.getTime());
        expect(sep5.lt.getTime()).toBeLessThanOrEqual(sep6.gte.getTime());

        const today = ymdIst();
        const closed = shiftYmdIst(today, -1);
        expect(closed).not.toBe(today);
        if (today === "2026-09-06") {
            expect(closed).toBe("2026-09-05");
        }
    });

    const tracker = new FixtureTracker("catchup");
    const yesterday = "2026-09-05";
    const today = "2026-09-06";
    const yRange = istDayRange(yesterday);
    const tRange = istDayRange(today);

    let parent: Awaited<ReturnType<typeof createTestUser>>;
    let child: Awaited<ReturnType<typeof createTestUser>>;
    let yBetId: string;
    let tBetId: string;

    beforeAll(async () => {
        await ensureSystemConfig();
        parent = await createTestUser(tracker, { balance: 0 });
        child = await createTestUser(tracker, {
            balance: 20_000,
            referredBy: parent.referralCode,
        });
        const period = await createWingoPeriod(tracker, {
            startTime: yRange.gte,
            endTime: new Date(yRange.gte.getTime() + 30_000),
        });
        const yBet = await prisma.wingoBet.create({
            data: {
                userId: child.id,
                periodId: period.id,
                betAmount: 1000,
                contractAmount: 980,
                betType: "COLOR",
                betChoice: "RED",
                createdAt: new Date(yRange.gte.getTime() + 6 * 3600_000),
            },
        });
        const tBet = await prisma.wingoBet.create({
            data: {
                userId: child.id,
                periodId: period.id,
                betAmount: 777,
                contractAmount: 761.46,
                betType: "COLOR",
                betChoice: "GREEN",
                createdAt: new Date(tRange.gte.getTime() + 2 * 3600_000),
            },
        });
        yBetId = yBet.id;
        tBetId = tBet.id;
        await prisma.userVipLevel.upsert({
            where: { userId: parent.id },
            create: {
                userId: parent.id,
                currentLevel: 0,
                rebateLevel: 3,
                teamSize: 0,
                teamBetting: 0,
                teamDeposit: 0,
            },
            update: { rebateLevel: 3 },
        });
    });

    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
            orderIdPrefix: tracker.orderPrefix,
        });
    });

    test("needsClose is true for unpaid 5 Sep and true for live 6 Sep", async () => {
        expect(await DailyTeamRebate.needsClose(yesterday)).toBe(true);
        expect(await DailyTeamRebate.needsClose(today)).toBe(true);
    });

    test("processClosedIstDay(5 Sep) pays 5 Sep only and leaves 6 Sep + rebateLevel", async () => {
        const result = await DailyTeamRebate.processClosedIstDay(yesterday, {
            resetRebateLevel: false,
        });
        expect(result.created).toBeGreaterThan(0);
        expect(result.settled).toBe(true);

        const yRows = await prisma.rebate.findMany({
            where: { betId: yBetId },
        });
        const tRows = await prisma.rebate.findMany({
            where: { betId: tBetId },
        });
        expect(yRows.length).toBeGreaterThan(0);
        expect(yRows.every((r) => r.settled)).toBe(true);
        expect(
            yRows.every(
                (r) => r.createdAt >= yRange.gte && r.createdAt < yRange.lt
            )
        ).toBe(true);
        expect(tRows.length).toBe(0);

        const todayWindow = await prisma.rebate.count({
            where: { createdAt: tRange },
        });
        expect(todayWindow).toBe(0);

        const vip = await prisma.userVipLevel.findUnique({
            where: { userId: parent.id },
        });
        expect(vip?.rebateLevel).toBe(3);

        expect(await DailyTeamRebate.needsClose(yesterday)).toBe(false);
        expect(await DailyTeamRebate.needsClose(today)).toBe(true);

        const paid = await prisma.user.findUnique({ where: { id: parent.id } });
        expect(Number(paid?.balance ?? 0)).toBeGreaterThan(0);
    });
});
