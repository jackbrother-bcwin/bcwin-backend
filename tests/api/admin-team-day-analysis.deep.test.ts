/**
 * Admin User Hub L1 business-leg analysis (ADR-0053).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { Cache } from "@bcwin/cache";
import { prisma } from "@bcwin/db";
import {
    parseYmdStartIst,
    shiftYmdIst,
    ymdIst,
} from "../../apps/api/src/lib/istDate";
import {
    FixtureTracker,
    authCookieFor,
    cleanupByUserIds,
    createTestUser,
    createWingoPeriod,
    ensureSystemConfig,
    get,
} from "../helpers";

describe("Admin team-day L1 business contribution (ADR-0053)", () => {
    const tracker = new FixtureTracker("teamleg");
    const date = shiftYmdIst(ymdIst(), -1);
    const warningDate = shiftYmdIst(date, -1);
    const dayStart = parseYmdStartIst(date);
    const warningStart = parseYmdStartIst(warningDate);
    const cacheKey = (rootId: string, ymd: string) =>
        `admin:user-team-day-analysis:v1:${rootId}:${ymd}`;

    let adminCookie: string;
    let rootCookie: string;
    let root: Awaited<ReturnType<typeof createTestUser>>;
    let a: Awaited<ReturnType<typeof createTestUser>>;
    let b: Awaited<ReturnType<typeof createTestUser>>;
    let c: Awaited<ReturnType<typeof createTestUser>>;
    let d: Awaited<ReturnType<typeof createTestUser>>;
    let a2: Awaited<ReturnType<typeof createTestUser>>;
    let a7: Awaited<ReturnType<typeof createTestUser>>;

    beforeAll(async () => {
        await ensureSystemConfig();
        const admin = await createTestUser(tracker, { role: "ADMIN" });
        root = await createTestUser(tracker);
        adminCookie = await authCookieFor(admin);
        rootCookie = await authCookieFor(root);

        a = await createTestUser(tracker, { referredBy: root.referralCode });
        b = await createTestUser(tracker, { referredBy: root.referralCode });
        c = await createTestUser(tracker, { referredBy: root.referralCode });
        d = await createTestUser(tracker, { referredBy: root.referralCode });

        a2 = await createTestUser(tracker, { referredBy: a.referralCode });
        const a3 = await createTestUser(tracker, { referredBy: a2.referralCode });
        const a4 = await createTestUser(tracker, { referredBy: a3.referralCode });
        const a5 = await createTestUser(tracker, { referredBy: a4.referralCode });
        const a6 = await createTestUser(tracker, { referredBy: a5.referralCode });
        a7 = await createTestUser(tracker, { referredBy: a6.referralCode });

        const demo = await createTestUser(tracker, {
            referredBy: root.referralCode,
        });
        await prisma.user.update({
            where: { id: demo.id },
            data: { isDemo: true },
        });

        const at = (start: Date, hours = 1) =>
            new Date(start.getTime() + hours * 60 * 60 * 1000);
        const deposit = (
            tag: string,
            userId: string,
            amount: number,
            createdAt: Date,
            status: "SUCCESS" | "FAILED" = "SUCCESS"
        ) => ({
            orderId: `${tracker.orderPrefix}${tag}`,
            amount,
            method: "UPI",
            status,
            userId,
            createdAt,
        });

        await prisma.deposit.createMany({
            data: [
                deposit("day-a", a.id, 20_000, at(dayStart)),
                deposit("day-a2", a2.id, 30_000, at(dayStart, 2)),
                deposit("day-b", b.id, 25_000, at(dayStart, 3)),
                deposit("day-c", c.id, 25_000, at(dayStart, 4)),
                deposit("day-d-failed", d.id, 999_999, at(dayStart), "FAILED"),
                deposit("day-self", root.id, 777_777, at(dayStart)),
                deposit("day-l7", a7.id, 888_888, at(dayStart)),
                deposit("day-demo", demo.id, 999_999, at(dayStart)),
                deposit("warn-a", a.id, 90_000, at(warningStart)),
                deposit("warn-b", b.id, 10_000, at(warningStart, 2)),
            ],
        });

        await prisma.withdraw.createMany({
            data: [
                {
                    orderId: `${tracker.orderPrefix}wd-a`,
                    amount: 10_000,
                    method: "UPI",
                    status: "SUCCESS",
                    userId: a.id,
                    createdAt: at(dayStart),
                },
                {
                    orderId: `${tracker.orderPrefix}wd-b`,
                    amount: 30_000,
                    method: "UPI",
                    status: "SUCCESS",
                    userId: b.id,
                    createdAt: at(dayStart, 2),
                },
                {
                    orderId: `${tracker.orderPrefix}wd-c`,
                    amount: 60_000,
                    method: "UPI",
                    status: "SUCCESS",
                    userId: c.id,
                    createdAt: at(dayStart, 3),
                },
                {
                    orderId: `${tracker.orderPrefix}wd-d-fail`,
                    amount: 500_000,
                    method: "UPI",
                    status: "FAILED",
                    userId: d.id,
                    createdAt: at(dayStart),
                },
            ],
        });

        const period = await createWingoPeriod(tracker, {
            startTime: at(dayStart),
        });
        await prisma.wingoBet.createMany({
            data: [
                {
                    userId: a.id,
                    periodId: period.id,
                    betAmount: 100,
                    contractAmount: 98,
                    betType: "COLOR",
                    betChoice: "RED",
                    createdAt: at(dayStart),
                },
                {
                    userId: b.id,
                    periodId: period.id,
                    betAmount: 500,
                    contractAmount: 490,
                    betType: "COLOR",
                    betChoice: "GREEN",
                    createdAt: at(dayStart, 2),
                },
                {
                    userId: c.id,
                    periodId: period.id,
                    betAmount: 300,
                    contractAmount: 294,
                    betType: "COLOR",
                    betChoice: "RED",
                    createdAt: at(dayStart, 3),
                },
            ],
        });
        await prisma.inoutBet.createMany({
            data: [
                {
                    userId: c.id,
                    token: "test",
                    gameMode: "SLOT",
                    betAmount: 100,
                    currency: "INR",
                    operator: "test",
                    transactionId: `${tracker.runId}-inout-ok`,
                    gameId: "test-game",
                    isSettled: true,
                    isRolledback: false,
                    winAmount: 0,
                    createdAt: at(dayStart, 4),
                },
                {
                    userId: a.id,
                    token: "test",
                    gameMode: "SLOT",
                    betAmount: 9_000,
                    currency: "INR",
                    operator: "test",
                    transactionId: `${tracker.runId}-inout-rollback`,
                    gameId: "test-game",
                    isSettled: true,
                    isRolledback: true,
                    winAmount: 0,
                    createdAt: at(dayStart, 4),
                },
            ],
        });

        await Promise.all([
            Cache.del(cacheKey(root.id, date)),
            Cache.del(cacheKey(root.id, warningDate)),
        ]);
    });

    afterAll(async () => {
        if (root) {
            await Promise.all([
                Cache.del(cacheKey(root.id, date)).catch(() => 0),
                Cache.del(cacheKey(root.id, warningDate)).catch(() => 0),
                Cache.del(
                    `user:salary-business-report:v1:${root.id}:${date}`
                ).catch(() => 0),
            ]);
        }
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
            orderIdPrefix: tracker.orderPrefix,
        });
    });

    test("partitions L1 legs, reconciles totals, and sorts independent shares", async () => {
        const depositRes = await get(
            `/api/v1/admin/users/${root.id}/team-day-analysis`,
            {
                cookie: adminCookie,
                query: { date, sortBy: "deposit", page: 1 },
            }
        );
        expect(depositRes.status).toBe(200);
        expect(depositRes.json.date).toBe(date);
        expect(depositRes.json.team.deposit.amount).toBe(100_000);
        expect(depositRes.json.self.deposit.amount).toBe(777_777);
        expect(depositRes.json.legs.map((leg: any) => leg.id)).toEqual([
            a.id,
            b.id,
            c.id,
            d.id,
        ]);

        const [legA, legB, legC, legD] = depositRes.json.legs;
        expect(legA.memberCount).toBe(6);
        expect(legA.deposit.amount).toBe(50_000);
        expect(legA.deposit.share).toBeCloseTo(50, 8);
        expect(legB.deposit.share).toBeCloseTo(25, 8);
        expect(legC.deposit.share).toBeCloseTo(25, 8);
        expect(legD.deposit.share).toBe(0);
        expect(depositRes.json.concentration.isConcentrated).toBe(false);

        const withdrawalRes = await get(
            `/api/v1/admin/users/${root.id}/team-day-analysis`,
            { cookie: adminCookie, query: { date, sortBy: "withdrawal" } }
        );
        expect(withdrawalRes.status).toBe(200);
        expect(withdrawalRes.json.team.withdrawal.amount).toBe(100_000);
        expect(withdrawalRes.json.legs.map((leg: any) => leg.id)).toEqual([
            c.id,
            b.id,
            a.id,
            d.id,
        ]);

        const betRes = await get(
            `/api/v1/admin/users/${root.id}/team-day-analysis`,
            { cookie: adminCookie, query: { date, sortBy: "bet" } }
        );
        expect(betRes.status).toBe(200);
        expect(betRes.json.team.bet.amount).toBe(1_000);
        expect(betRes.json.legs.map((leg: any) => leg.id)).toEqual([
            b.id,
            c.id,
            a.id,
            d.id,
        ]);
    });

    test("warns only above 80 percent and rejects today", async () => {
        const warningRes = await get(
            `/api/v1/admin/users/${root.id}/team-day-analysis`,
            { cookie: adminCookie, query: { date: warningDate } }
        );
        expect(warningRes.status).toBe(200);
        expect(warningRes.json.concentration.isConcentrated).toBe(true);
        expect(warningRes.json.concentration.leader.id).toBe(a.id);
        expect(warningRes.json.concentration.leader.share).toBeCloseTo(90, 8);

        const todayRes = await get(
            `/api/v1/admin/users/${root.id}/team-day-analysis`,
            { cookie: adminCookie, query: { date: ymdIst() } }
        );
        expect(todayRes.status).toBe(400);
    });

    test("user salary report is team-only and privacy-limited", async () => {
        await Cache.del(
            `user:salary-business-report:v1:${root.id}:${date}`
        );
        const response = await get("/api/v1/user/salary/business-report", {
            cookie: rootCookie,
            query: {
                day: "yesterday",
                sortBy: "deposit",
                page: 1,
                limit: 10,
            },
        });

        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(response.json.date).toBe(date);
        expect(response.json.team).toEqual({
            l1Count: 4,
            deposit: 100_000,
            withdrawal: 100_000,
        });
        expect(response.json.levels[0]).toEqual({
            level: 1,
            deposit: 70_000,
            withdrawal: 100_000,
        });
        expect(response.json.levels[1]).toEqual({
            level: 2,
            deposit: 30_000,
            withdrawal: 0,
        });
        expect(response.json.legs.map((leg: any) => leg.uid)).toEqual([
            a.serialNumber,
            b.serialNumber,
            c.serialNumber,
        ]);
        expect(response.json.legs[0].deposit).toEqual({
            amount: 50_000,
            share: 50,
        });
        expect(response.json.pagination.total).toBe(3);

        const serialized = JSON.stringify(response.json);
        expect(serialized).not.toContain(a.id);
        expect(serialized).not.toContain(a.mobileNumber);
        expect(response.json).not.toHaveProperty("self");
        expect(response.json.legs[0]).not.toHaveProperty("memberCount");
    });
});
