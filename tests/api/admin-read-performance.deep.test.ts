import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@bcwin/db";
import { Cache } from "@bcwin/cache";
import { cachedAdminRead } from "../../apps/api/src/lib/cachedAdminRead";
import { calculateUserStats } from "../../apps/api/src/routes/admin/users/helpers";
import {
    FixtureTracker, authCookieFor, cleanupByUserIds, createTestUser,
    createWingoPeriod, ensureSystemConfig, get,
} from "../helpers";

describe("Admin bounded history and grouped hub reads", () => {
    const tracker = new FixtureTracker("adminread");
    let cookie: string;
    let player: Awaited<ReturnType<typeof createTestUser>>;
    let direct: Awaited<ReturnType<typeof createTestUser>>;
    let deep: Awaited<ReturnType<typeof createTestUser>>;
    const ids: string[] = [];
    beforeAll(async () => {
        await ensureSystemConfig();
        cookie = await authCookieFor(await createTestUser(tracker, { role: "ADMIN" }));
        player = await createTestUser(tracker, { balance: 888_888_888 });
        direct = await createTestUser(tracker, { referredBy: player.referralCode });
        deep = await createTestUser(tracker, { referredBy: direct.referralCode });
        const start = Date.UTC(2026, 0, 1);
        const period = await createWingoPeriod(tracker, {
            durationSeconds: 30,
            startTime: new Date(start),
            suffix: "history",
        });
        for (let i = 0; i < 24; i++) {
            const bet = await prisma.wingoBet.create({ data: {
                userId: player.id, periodId: period.id, betAmount: 10,
                contractAmount: 9.8, betType: "NUMBER", betChoice: "1",
                status: i < 6 ? "WON" : i < 12 ? "LOST" : "PENDING",
                createdAt: new Date(start + i * 2000),
            } });
            ids.push(bet.id);
            if (i < 12) await prisma.wingoBetResult.create({ data: {
                betId: bet.id, periodId: period.id, isWin: i < 6,
                winAmount: i < 6 ? 20 : 0,
            } });
        }
        await prisma.inoutBet.createMany({ data: [
            ...Array.from({ length: 24 }, (_, i) => ({
                userId: player.id, transactionId: tracker.runId + i, token: "test",
                gameMode: "Speed Slots", gameId: "test", operator: "test", currency: "INR",
                betAmount: 5, winAmount: i < 6 ? 8 : 0, isSettled: i < 12,
                createdAt: new Date(start + i * 2000 + 1000),
            })),
            ...[direct, deep].map((user, i) => ({
                userId: user.id, transactionId: tracker.runId + user.id, token: "test",
                gameMode: "Speed Slots", gameId: "test", operator: "test", currency: "INR",
                betAmount: (i + 1) * 100, winAmount: 0,
            })),
        ] });
        await prisma.deposit.createMany({ data: [
            { userId: direct.id, amount: 100, status: "SUCCESS", method: "UPI", orderId: tracker.orderPrefix + "d1" },
            { userId: direct.id, amount: 200, status: "SUCCESS", method: "UPI", orderId: tracker.orderPrefix + "d2" },
            { userId: deep.id, amount: 400, status: "SUCCESS", method: "UPI", orderId: tracker.orderPrefix + "d3" },
            { userId: deep.id, amount: 999, status: "FAILED", method: "UPI", orderId: tracker.orderPrefix + "d4" },
        ] });
    });
    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix, orderIdPrefix: tracker.orderPrefix,
        });
    });
    const history = (query: Record<string, string | number>) =>
        get("/api/v1/admin/transactions/game-history", {
            cookie, query: { userId: player.id, limit: 5, ...query },
        });

    test("bounds each source and merges pages without missing bets", async () => {
        const first = await history({ page: 1 });
        const second = await history({ page: 2 });
        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(first.json.total).toBe(48);
        expect(second.json.totalPages).toBe(10);
        expect(new Set([...first.json.bets, ...second.json.bets].map((b: any) => b.id)).size).toBe(10);
        expect(first.json.bets[1].id).toBe(ids[23]);
        expect(second.json.bets[0].id).toBe(ids[21]);
        expect(first.json.bets).toHaveLength(5);
        expect(second.json.bets).toHaveLength(5);
    });
    test("filters wins before the window, even when all winners are older", async () => {
        const response = await history({ wins: "true", page: 2 });
        expect(response.status).toBe(200);
        expect(response.json.total).toBe(12);
        expect(response.json.bets).toHaveLength(5);
        expect(response.json.bets.every((b: any) => b.winAmount > 0)).toBe(true);
    });
    test("zero-win filter includes pending bets without a result", async () => {
        const response = await history({ wins: "false" });
        expect(response.status).toBe(200);
        expect(response.json.total).toBe(36);
        expect(response.json.bets.every((b: any) => b.winAmount === 0)).toBe(true);
    });
    test("duration and vendor name filters retain exact totals", async () => {
        for (const gameName of ["30sec", "sPeEd"]) {
            const response = await history({ gameName, wins: "true", page: 2 });
            expect(response.status).toBe(200);
            expect(response.json.total).toBe(6);
            expect(response.json.bets).toHaveLength(1);
        }
        const absent = await history({ gameName: "not-a-game" });
        expect(absent.json.total).toBe(0);
    });
    test("Inout settlement status is accurate", async () => {
        const pending = await history({ gameName: "Speed" });
        expect(pending.json.bets.every((b: any) => b.status === "PENDING")).toBe(true);
        const settled = await history({ gameName: "Speed", wins: "true" });
        expect(settled.json.bets.every((b: any) => b.status === "SETTLED")).toBe(true);
    });
    test("hub grouped totals preserve self, direct, team and distinct active counts", async () => {
        const stats = await calculateUserStats(player.id);
        expect(stats.totalBet).toBe(360);
        expect(stats.directBet).toBe(100);
        expect(stats.downlinkBet).toBe(300);
        expect(stats.directRecharge).toBe(300);
        expect(stats.downlinkRecharge).toBe(700);
        expect(stats.subordinatesWithFirstDepositCount).toBe(2);
        expect(stats.subordinatesWithBetsCount).toBe(2);

        const hub = await get(`/api/v1/admin/users/${player.id}`, { cookie });
        expect(hub.status).toBe(200);
        expect(hub.json.user.stats).toMatchObject({
            totalBet: 360,
            directBet: 100,
            downlinkBet: 300,
            directRecharge: 300,
            downlinkRecharge: 700,
            subordinatesWithFirstDepositCount: 2,
            subordinatesWithBetsCount: 2,
        });
    });
    test("empty later pages and unmatched names stay 200", async () => {
        const empty = await history({ page: 50 });
        expect(empty.status).toBe(200);
        expect(empty.json.bets).toEqual([]);
        expect(empty.json.total).toBe(48);
        const missing = await history({ gameName: "not-a-game", page: 3 });
        expect(missing.status).toBe(200);
        expect(missing.json.total).toBe(0);
        expect(missing.json.bets).toEqual([]);
    });
    test("last bets and top-50 survive cache JSON round-trip", async () => {
        await Promise.all([
            Cache.del("admin:recent-wingo:v1"),
            Cache.del("admin:top-users:v1:balance"),
        ]);
        const [firstBets, secondBets] = await Promise.all([
            get("/api/v1/admin/dashboard/wingo-bets", { cookie }),
            get("/api/v1/admin/dashboard/wingo-bets", { cookie }),
        ]);
        expect(firstBets.status).toBe(200);
        expect(secondBets.status).toBe(200);
        expect(firstBets.json.bets.length).toBeLessThanOrEqual(50);
        expect(secondBets.json).toEqual(firstBets.json);

        const [firstTop, secondTop] = await Promise.all([
            get("/api/v1/admin/dashboard/top-users", { cookie, query: { sort: "balance" } }),
            get("/api/v1/admin/dashboard/top-users", { cookie, query: { sort: "balance" } }),
        ]);
        expect(firstTop.status).toBe(200);
        expect(secondTop.status).toBe(200);
        expect(firstTop.json.users.length).toBeLessThanOrEqual(100);
        expect(secondTop.json).toEqual(firstTop.json);
        expect(secondTop.json.users.some((row: any) => row.user.id === player.id)).toBe(true);

        const yesterday = await get(`/api/v1/admin/users/${player.id}/yesterday-stats`, { cookie });
        expect(yesterday.status).toBe(200);
        expect(yesterday.json.success).toBe(true);
        expect(Array.isArray(yesterday.json.levels)).toBe(true);

        for (const mode of ["all", "players", "teams"]) {
            const top = await get("/api/v1/admin/top-performance", {
                cookie, query: { timeFilter: "all_time", mode },
            });
            expect(top.status).toBe(200);
            expect(top.json.success).toBe(true);
            expect(Array.isArray(top.json.data?.topPerformers)).toBe(true);
        }
    });
    test("concurrent cache misses share work and failures can be retried", async () => {
        const key = "test:admin-read:" + tracker.runId;
        await Cache.del(key);
        let calls = 0;
        const compute = async () => { calls++; return { value: 42 }; };
        const results = await Promise.all(Array.from({ length: 20 }, () => cachedAdminRead(key, 5, compute)));
        expect(calls).toBe(1);
        expect(results.every((row) => row.value === 42)).toBe(true);
        await Cache.del(key);
        await expect(cachedAdminRead(key, 5, async () => { throw new Error("retry"); })).rejects.toThrow("retry");
        expect(await cachedAdminRead(key, 5, compute)).toEqual({ value: 42 });
        await Cache.del(key);
    });
});
