/**
 * Agent Commission people GROUP BY (ADR-0048).
 * Collapsed list totals all rebate rows; expand still pages /history.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@bcwin/db";
import { Cache } from "@bcwin/cache";
import { parseYmdStartIst, ymdIst } from "../../apps/api/src/lib/istDate";
import {
    FixtureTracker,
    authCookieFor,
    cleanupByUserIds,
    createTestUser,
    ensureSystemConfig,
    get,
} from "../helpers";

function atIst(ymd: string, hour = 12): Date {
    return new Date(parseYmdStartIst(ymd).getTime() + hour * 3600 * 1000);
}

describe("Rebate people totals (ADR-0048)", () => {
    const tracker = new FixtureTracker("rpl");
    const day = ymdIst();

    let parent: Awaited<ReturnType<typeof createTestUser>>;
    let a: Awaited<ReturnType<typeof createTestUser>>;
    let b: Awaited<ReturnType<typeof createTestUser>>;
    let cookie: string;

    beforeAll(async () => {
        await ensureSystemConfig();
        parent = await createTestUser(tracker, { balance: 0 });
        a = await createTestUser(tracker, {
            balance: 0,
            referredBy: parent.referralCode,
        });
        b = await createTestUser(tracker, {
            balance: 0,
            referredBy: parent.referralCode,
        });
        cookie = await authCookieFor(parent);

        const rows: Array<{
            userId: string;
            fromUserId: string;
            layer: number;
            gameCategory: "LOTTERY";
            game: string;
            betAmount: number;
            amount: number;
            rate: number;
            settled: boolean;
            createdAt: Date;
        }> = [];
        for (let i = 0; i < 80; i++) {
            rows.push({
                userId: parent.id,
                fromUserId: a.id,
                layer: 1,
                gameCategory: "LOTTERY",
                game: "WINGO",
                betAmount: 10,
                amount: 0.05,
                rate: 0.5,
                settled: true,
                createdAt: atIst(day, 8),
            });
        }
        for (let i = 0; i < 40; i++) {
            rows.push({
                userId: parent.id,
                fromUserId: b.id,
                layer: 1,
                gameCategory: "LOTTERY",
                game: "WINGO",
                betAmount: 20,
                amount: 0.1,
                rate: 0.5,
                settled: true,
                createdAt: atIst(day, 9),
            });
        }
        await prisma.rebate.createMany({ data: rows });
        await Cache.del(`user:${parent.id}:rebate-people`).catch(() => 0);
        await Cache.del(`user:${parent.id}:rebate-history`).catch(() => 0);
    });

    afterAll(async () => {
        await prisma.rebate.deleteMany({ where: { userId: parent.id } });
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
            giftCodePrefix: tracker.giftPrefix,
            orderIdPrefix: tracker.orderPrefix,
        });
    });

    test("people totals include every row, not a 100-row page", async () => {
        const res = await get("/api/v1/user/rebate/people", {
            cookie,
            query: { startDate: day, endDate: day, settled: "true" },
        });
        expect(res.status).toBe(200);
        const people = (res.json?.data?.people ?? []) as Array<{
            fromUserId: string;
            commission: number;
            betVolume: number;
            bets: number;
            layer: number;
        }>;
        const pa = people.find((p) => p.fromUserId === a.id);
        const pb = people.find((p) => p.fromUserId === b.id);
        expect(Number(pa?.bets)).toBe(80);
        expect(Number(pa?.betVolume)).toBe(800);
        expect(Number(pa?.commission)).toBeCloseTo(4, 5);
        expect(Number(pb?.bets)).toBe(40);
        expect(Number(pb?.betVolume)).toBe(800);
        expect(Number(pb?.commission)).toBeCloseTo(4, 5);
        expect(Number(res.json?.data?.summary?.bets)).toBe(120);
        expect(Number(res.json?.data?.summary?.bettors)).toBe(2);
        expect(Number(res.json?.data?.summary?.betVolume)).toBe(1600);
        expect(Number(res.json?.data?.byLayer?.L1?.users)).toBe(2);
        expect(Number(res.json?.data?.byLayer?.L1?.commission)).toBeCloseTo(8, 5);
        expect(res.json?.data?.byDay?.[0]?.date).toBe(day);
    });

    test("expand still pages bet rows for one downline", async () => {
        const res = await get("/api/v1/user/rebate/history", {
            cookie,
            query: {
                startDate: day,
                endDate: day,
                settled: "true",
                fromUserId: a.id,
                page: 1,
                limit: 10,
            },
        });
        expect(res.status).toBe(200);
        expect((res.json?.data ?? []).length).toBe(10);
        expect(Number(res.json?.total)).toBe(80);
        expect(Number(res.json?.totalPages)).toBe(8);
    });
});
