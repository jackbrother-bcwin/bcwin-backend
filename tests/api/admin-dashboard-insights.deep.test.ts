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

describe("Admin dashboard insights", () => {
    const tracker = new FixtureTracker("adi");
    let adminCookie: string;
    let player: Awaited<ReturnType<typeof createTestUser>>;
    let live30: Awaited<ReturnType<typeof createWingoPeriod>>;
    let live60: Awaited<ReturnType<typeof createWingoPeriod>>;
    let settledBetId: string;

    beforeAll(async () => {
        await ensureSystemConfig();
        const admin = await createTestUser(tracker, { role: "ADMIN" });
        player = await createTestUser(tracker, { balance: 999_999_999 });
        adminCookie = await authCookieFor(admin);

        const now = new Date();
        live30 = await createWingoPeriod(tracker, {
            durationSeconds: 30,
            startTime: new Date(now.getTime() - 1_000),
            endTime: new Date(now.getTime() + 120_000),
            suffix: "live30",
        });
        live60 = await createWingoPeriod(tracker, {
            durationSeconds: 60,
            startTime: now,
            endTime: new Date(now.getTime() + 120_000),
            suffix: "live60",
        });

        await prisma.wingoBet.createMany({
            data: [
                {
                    userId: player.id,
                    periodId: live30.id,
                    betAmount: 100,
                    contractAmount: 98,
                    betType: "NUMBER",
                    betChoice: "7",
                },
                {
                    userId: player.id,
                    periodId: live30.id,
                    betAmount: 50,
                    contractAmount: 49,
                    betType: "NUMBER",
                    betChoice: "7",
                },
                {
                    userId: player.id,
                    periodId: live60.id,
                    betAmount: 200,
                    contractAmount: 196,
                    betType: "COLOR",
                    betChoice: "GREEN",
                },
            ],
        });

        const settledPeriod = await createWingoPeriod(tracker, {
            durationSeconds: 60,
            startTime: new Date(now.getTime() - 180_000),
            endTime: new Date(now.getTime() - 120_000),
            status: "RESOLVED",
            resultNumber: 7,
            resultColor: "GREEN",
            resultSize: "BIG",
            suffix: "settled",
        });
        const settledBet = await prisma.wingoBet.create({
            data: {
                userId: player.id,
                periodId: settledPeriod.id,
                betAmount: 300,
                contractAmount: 294,
                betType: "NUMBER",
                betChoice: "7",
                status: "WON",
            },
        });
        settledBetId = settledBet.id;
        await prisma.wingoBetResult.create({
            data: {
                betId: settledBet.id,
                periodId: settledPeriod.id,
                isWin: true,
                winAmount: 2_646,
                multiplier: 9,
                processedAt: new Date("2099-01-01T00:00:00.000Z"),
            },
        });

        await prisma.withdraw.createMany({
            data: [
                {
                    orderId: `${tracker.orderPrefix}success-1`,
                    amount: 1_000_000_000,
                    method: "UPI",
                    status: "SUCCESS",
                    userId: player.id,
                },
                {
                    orderId: `${tracker.orderPrefix}failed`,
                    amount: 500_000_000,
                    method: "UPI",
                    status: "FAILED",
                    userId: player.id,
                },
            ],
        });
    });

    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
            orderIdPrefix: tracker.orderPrefix,
        });
    });

    test("live cards return current 30s and 1m bet totals and selections", async () => {
        const response = await get("/api/v1/admin/dashboard/wingo-live", {
            cookie: adminCookie,
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("private, no-store");

        const period30 = response.json?.periods?.find(
            (period: { id: string }) => period.id === live30.id
        );
        const period60 = response.json?.periods?.find(
            (period: { id: string }) => period.id === live60.id
        );
        expect(period30?.betCount).toBe(2);
        expect(period30?.totalBetAmount).toBe(150);
        expect(period30?.selections?.[0]).toMatchObject({
            betType: "NUMBER",
            betChoice: "7",
            betCount: 2,
            amount: 150,
        });
        expect(period60?.betCount).toBe(1);
        expect(period60?.totalBetAmount).toBe(200);
    });

    test("recent list returns settled bets with user and draw result", async () => {
        const response = await get("/api/v1/admin/dashboard/wingo-bets", {
            cookie: adminCookie,
        });
        expect(response.status).toBe(200);
        expect(response.json?.bets?.length).toBeLessThanOrEqual(50);

        const row = response.json?.bets?.find(
            (bet: { id: string }) => bet.id === settledBetId
        );
        expect(row).toMatchObject({
            id: settledBetId,
            betAmount: 300,
            betChoice: "7",
            resultNumber: 7,
            status: "WON",
            winAmount: 2_646,
        });
        expect(row?.user?.id).toBe(player.id);
    });

    test("top users supports balance and successful-withdrawal ranking", async () => {
        const byBalance = await get("/api/v1/admin/dashboard/top-users", {
            cookie: adminCookie,
            query: { sort: "balance" },
        });
        expect(byBalance.status).toBe(200);
        const balanceRow = byBalance.json?.users?.find(
            (row: { user: { id: string } }) => row.user.id === player.id
        );
        expect(balanceRow?.balance).toBe(999_999_999);
        expect(balanceRow?.successfulWithdrawAmount).toBe(1_000_000_000);
        expect(balanceRow?.successfulWithdrawCount).toBe(1);

        const byWithdraw = await get("/api/v1/admin/dashboard/top-users", {
            cookie: adminCookie,
            query: { sort: "withdrawals" },
        });
        expect(byWithdraw.status).toBe(200);
        const withdrawRow = byWithdraw.json?.users?.find(
            (row: { user: { id: string } }) => row.user.id === player.id
        );
        expect(withdrawRow).toMatchObject({
            successfulWithdrawAmount: 1_000_000_000,
            successfulWithdrawCount: 1,
        });
        expect(withdrawRow?.rank).toBeGreaterThan(0);
    });
});
