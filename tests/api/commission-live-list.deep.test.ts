/**
 * Agent Commission Today list under Excel is live preview people (ADR-0049).
 * Expand pages that person’s today bets. Not Rebate rows until 24:00.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@bcwin/db";
import {
    FixtureTracker,
    authCookieFor,
    cleanupByUserIds,
    createTestUser,
    createWingoPeriod,
    ensureSystemConfig,
    get,
} from "../helpers";
import { ymdIst } from "../../apps/api/src/lib/istDate";
import { DailyTeamRebate } from "../../packages/rebate/dailyTeamRebate";

describe("Agent commission live today list (ADR-0049)", () => {
    const tracker = new FixtureTracker("cll");
    const today = ymdIst();

    let parent: Awaited<ReturnType<typeof createTestUser>>;
    let l1: Awaited<ReturnType<typeof createTestUser>>;
    let cookie: string;
    let periodId: string;

    beforeAll(async () => {
        await ensureSystemConfig();
        parent = await createTestUser(tracker, { balance: 0 });
        l1 = await createTestUser(tracker, {
            balance: 20_000,
            referredBy: parent.referralCode,
        });
        cookie = await authCookieFor(parent);
        const period = await createWingoPeriod(tracker, {
            startTime: new Date(),
        });
        periodId = period.id;
        await prisma.wingoBet.create({
            data: {
                userId: l1.id,
                periodId,
                betAmount: 200,
                contractAmount: 196,
                betType: "COLOR",
                betChoice: "RED",
            },
        });
        await prisma.wingoBet.create({
            data: {
                userId: l1.id,
                periodId,
                betAmount: 50,
                contractAmount: 49,
                betType: "COLOR",
                betChoice: "GREEN",
            },
        });
        await prisma.userVipLevel.upsert({
            where: { userId: parent.id },
            create: {
                userId: parent.id,
                currentLevel: 0,
                rebateLevel: 0,
                teamSize: 0,
                teamBetting: 0,
                teamDeposit: 0,
            },
            update: { rebateLevel: 0 },
        });
    });

    afterAll(async () => {
        await prisma.wingoBet.deleteMany({ where: { userId: l1.id } });
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
            giftCodePrefix: tracker.giftPrefix,
            orderIdPrefix: tracker.orderPrefix,
        });
    });

    test("day-preview people match live commission and are not in wallet", async () => {
        const prev = await DailyTeamRebate.previewForUser(parent.id, today);
        expect(prev.people.length).toBe(1);
        expect(prev.people[0]?.fromUserId).toBe(l1.id);
        expect(Number(prev.people[0]?.bets)).toBe(2);
        expect(Number(prev.people[0]?.betVolume)).toBe(250);
        expect(Number(prev.people[0]?.commission)).toBeCloseTo(
            prev.totalCommission,
            3
        );
        const u = await prisma.user.findUnique({ where: { id: parent.id } });
        expect(Number(u?.balance ?? 0)).toBe(0);
        const rows = await prisma.rebate.count({
            where: { userId: parent.id, fromUserId: l1.id },
        });
        expect(rows).toBe(0);

        const res = await get("/api/v1/user/rebate/day-preview", {
            cookie,
            query: { date: today },
        });
        expect(res.status).toBe(200);
        expect((res.json?.data?.people ?? []).length).toBe(1);
        expect(Number(res.json?.data?.people?.[0]?.bets)).toBe(2);
    });

    test("person-bets pages live today bets as pending", async () => {
        const res = await get("/api/v1/user/rebate/person-bets", {
            cookie,
            query: {
                fromUserId: l1.id,
                startDate: today,
                endDate: today,
                page: 1,
                limit: 10,
            },
        });
        expect(res.status).toBe(200);
        const data = res.json?.data ?? [];
        expect(data.length).toBe(2);
        expect(data.every((r: { settled?: boolean }) => r.settled === false)).toBe(
            true
        );
        expect(Number(res.json?.total)).toBe(2);
        const vol = data.reduce(
            (s: number, r: { betAmount?: number }) => s + Number(r.betAmount ?? 0),
            0
        );
        expect(vol).toBe(250);
    });
});
