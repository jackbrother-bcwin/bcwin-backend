/**
 * Subordinate data cards: Total bet + Bets are that IST day (ADR-0047).
 * Batched GROUP BY — same numbers as the old per-card loop.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import {
    FixtureTracker,
    authCookieFor,
    cleanupByUserIds,
    createTestUser,
    createWingoPeriod,
    ensureSystemConfig,
    get,
} from "../helpers";
import { parseYmdStartIst } from "../../apps/api/src/lib/istDate";

describe("Subordinate data day bets (ADR-0047)", () => {
    const tracker = new FixtureTracker("sdb");
    const day = "2026-08-25";
    const otherDay = "2026-08-24";
    const dayStart = parseYmdStartIst(day);
    const otherStart = parseYmdStartIst(otherDay);

    let parent: Awaited<ReturnType<typeof createTestUser>>;
    let a: Awaited<ReturnType<typeof createTestUser>>;
    let b: Awaited<ReturnType<typeof createTestUser>>;
    let c: Awaited<ReturnType<typeof createTestUser>>;
    let cookie: string;

    beforeAll(async () => {
        await ensureSystemConfig();
        parent = await createTestUser(tracker, { balance: 0 });
        a = await createTestUser(tracker, {
            balance: 20_000,
            referredBy: parent.referralCode,
        });
        b = await createTestUser(tracker, {
            balance: 20_000,
            referredBy: parent.referralCode,
        });
        c = await createTestUser(tracker, {
            balance: 20_000,
            referredBy: parent.referralCode,
        });
        cookie = await authCookieFor(parent);

        const period = await createWingoPeriod(tracker, {
            startTime: new Date(dayStart.getTime() + 3600_000),
        });

        await prisma.wingoBet.create({
            data: {
                userId: a.id,
                periodId: period.id,
                betAmount: 100,
                contractAmount: 98,
                betType: "COLOR",
                betChoice: "RED",
                createdAt: new Date(dayStart.getTime() + 2 * 3600_000),
            },
        });
        await prisma.wingoBet.create({
            data: {
                userId: a.id,
                periodId: period.id,
                betAmount: 50,
                contractAmount: 49,
                betType: "COLOR",
                betChoice: "GREEN",
                createdAt: new Date(dayStart.getTime() + 3 * 3600_000),
            },
        });
        await prisma.wingoBet.create({
            data: {
                userId: b.id,
                periodId: period.id,
                betAmount: 250,
                contractAmount: 245,
                betType: "COLOR",
                betChoice: "RED",
                createdAt: new Date(dayStart.getTime() + 4 * 3600_000),
            },
        });
        await prisma.wingoBet.create({
            data: {
                userId: c.id,
                periodId: period.id,
                betAmount: 999,
                contractAmount: 979,
                betType: "COLOR",
                betChoice: "RED",
                createdAt: new Date(otherStart.getTime() + 2 * 3600_000),
            },
        });
        await prisma.deposit.create({
            data: {
                orderId: `${tracker.orderPrefix}a25`,
                amount: 700,
                method: "UPI",
                status: "SUCCESS",
                userId: a.id,
                createdAt: new Date(dayStart.getTime() + 1 * 3600_000),
            },
        });

        await Cache.del(CacheKey.teamMembers(parent.id)).catch(() => 0);
    });

    afterAll(async () => {
        await prisma.wingoBet.deleteMany({
            where: { userId: { in: [a.id, b.id, c.id] } },
        });
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
            giftCodePrefix: tracker.giftPrefix,
            orderIdPrefix: tracker.orderPrefix,
        });
    });

    test("cards and summary use that IST day’s stake, not lifetime", async () => {
        const res = await get("/api/v1/user/team/members", {
            cookie,
            query: { date: day, page: 1, limit: 100 },
        });
        expect(res.status).toBe(200);
        const rows = (res.json?.data ?? []) as Array<{
            id: string;
            totalBetting: number;
            betCount?: number;
            totalDeposit: number;
        }>;
        const ids = rows.map((r) => r.id);
        expect(ids).toContain(a.id);
        expect(ids).toContain(b.id);
        expect(ids).not.toContain(c.id);

        const ra = rows.find((r) => r.id === a.id)!;
        const rb = rows.find((r) => r.id === b.id)!;
        expect(Number(ra.totalBetting)).toBe(150);
        expect(Number(ra.betCount)).toBe(2);
        expect(Number(ra.totalDeposit)).toBe(700);
        expect(Number(rb.totalBetting)).toBe(250);
        expect(Number(rb.betCount)).toBe(1);

        expect(Number(res.json?.summary?.totalBetting)).toBe(400);
        expect(Number(res.json?.summary?.bettors)).toBe(2);
        expect(Number(res.json?.summary?.totalDeposit)).toBe(700);
    });

    test("other IST day only lists that day’s bettor", async () => {
        await Cache.del(CacheKey.teamMembers(parent.id)).catch(() => 0);
        const res = await get("/api/v1/user/team/members", {
            cookie,
            query: { date: otherDay, page: 1, limit: 100 },
        });
        expect(res.status).toBe(200);
        const rows = (res.json?.data ?? []) as Array<{
            id: string;
            totalBetting: number;
            betCount?: number;
        }>;
        expect(rows.map((r) => r.id)).toEqual([c.id]);
        expect(Number(rows[0]?.totalBetting)).toBe(999);
        expect(Number(rows[0]?.betCount)).toBe(1);
        expect(Number(res.json?.summary?.totalBetting)).toBe(999);
    });
});
