/**
 * Agent Commission banner bet volume is IST today (ADR-0031).
 *
 * GET /user/team/overview?date=today sums L1–L6 stake that day
 * (lottery + live Inout). Undated overview stays lifetime + TeamMetrics.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import {
    parseYmdStartIst,
    shiftYmdIst,
    ymdIst,
} from "../../apps/api/src/lib/istDate";
import {
    get,
    FixtureTracker,
    createTestUser,
    createWingoPeriod,
    authCookieFor,
    cleanupByUserIds,
    ensureSystemConfig,
} from "../helpers";

function n(v: unknown): number {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
}

function atIst(ymd: string, hour = 12): Date {
    return new Date(parseYmdStartIst(ymd).getTime() + hour * 3600 * 1000);
}

describe("Agent Commission today live bet volume (ADR-0031)", () => {
    const tracker = new FixtureTracker("actv");
    const today = ymdIst();
    const yest = shiftYmdIst(today, -1);

    let parent: Awaited<ReturnType<typeof createTestUser>>;
    let l1: Awaited<ReturnType<typeof createTestUser>>;
    let cookie: string;

    beforeAll(async () => {
        await ensureSystemConfig();
        parent = await createTestUser(tracker, { balance: 0 });
        l1 = await createTestUser(tracker, {
            balance: 5000,
            referredBy: parent.referralCode,
        });
        cookie = await authCookieFor(parent);

        const period = await createWingoPeriod(tracker, {
            startTime: atIst(today, 10),
        });

        await prisma.wingoBet.createMany({
            data: [
                {
                    userId: l1.id,
                    periodId: period.id,
                    betAmount: 200,
                    contractAmount: 196,
                    betType: "COLOR",
                    betChoice: "RED",
                    createdAt: atIst(yest, 14),
                },
                {
                    userId: l1.id,
                    periodId: period.id,
                    betAmount: 50,
                    contractAmount: 49,
                    betType: "COLOR",
                    betChoice: "GREEN",
                    createdAt: atIst(today, 11),
                },
            ],
        });

        await prisma.inoutBet.createMany({
            data: [
                {
                    userId: l1.id,
                    token: `${tracker.runId}-live`,
                    gameMode: "inout",
                    betAmount: 30,
                    currency: "INR",
                    operator: "op1",
                    transactionId: `${tracker.orderPrefix}inout-live`,
                    gameId: "g1",
                    winAmount: 0,
                    createdAt: atIst(today, 12),
                },
                {
                    userId: l1.id,
                    token: `${tracker.runId}-rb`,
                    gameMode: "inout",
                    betAmount: 999,
                    currency: "INR",
                    operator: "op1",
                    transactionId: `${tracker.orderPrefix}inout-rb`,
                    gameId: "g1",
                    winAmount: 0,
                    isRolledback: true,
                    createdAt: atIst(today, 13),
                },
            ],
        });

        await Cache.del(CacheKey.teamOverview(parent.id));
        await Cache.del(`${CacheKey.teamOverview(parent.id)}:${today}`);
        await Cache.del(`${CacheKey.teamOverview(parent.id)}:${yest}`);
    });

    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
            giftCodePrefix: tracker.giftPrefix,
            orderIdPrefix: tracker.orderPrefix,
        });
        await Cache.del(CacheKey.teamOverview(parent.id));
        await Cache.del(`${CacheKey.teamOverview(parent.id)}:${today}`);
        await Cache.del(`${CacheKey.teamOverview(parent.id)}:${yest}`);
    });

    test("dated today is live stake (wingo + Inout, not rolled back)", async () => {
        const res = await get("/api/v1/user/team/overview", {
            cookie,
            query: { date: today },
        });
        expect(res.status).toBe(200);
        expect(n(res.json?.data?.totalTeamBetting)).toBe(80);
    });

    test("dated yesterday excludes today's bets", async () => {
        const res = await get("/api/v1/user/team/overview", {
            cookie,
            query: { date: yest },
        });
        expect(res.status).toBe(200);
        expect(n(res.json?.data?.totalTeamBetting)).toBe(200);
    });

    test("undated overview is lifetime and writes TeamMetrics", async () => {
        const res = await get("/api/v1/user/team/overview", { cookie });
        expect(res.status).toBe(200);
        expect(n(res.json?.data?.totalTeamBetting)).toBe(280);
        expect(n(res.json?.data?.totalTeamSize)).toBe(1);

        await new Promise((r) => setTimeout(r, 80));
        const metrics = await prisma.teamMetrics.findUnique({
            where: { userId: parent.id },
        });
        expect(metrics?.totalTeamBetting).toBe(280);
        expect(metrics?.totalTeamSize).toBe(1);
    });

    test("dated today does not overwrite lifetime TeamMetrics", async () => {
        await get("/api/v1/user/team/overview", {
            cookie,
            query: { date: today },
        });
        const metrics = await prisma.teamMetrics.findUnique({
            where: { userId: parent.id },
        });
        expect(metrics?.totalTeamBetting).toBe(280);
    });
});
