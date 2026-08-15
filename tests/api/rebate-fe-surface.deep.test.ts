/**
 * API surfaces used by FE agency/history for rebate-only commission.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "@bcwin/db";
import {
    get,
    FixtureTracker,
    createTestUser,
    authCookieFor,
    cleanupByUserIds,
    ensureSystemConfig,
} from "../helpers";
import { RebateCalculator } from "../../packages/rebate/rebateCalculator";
import { Cache, CacheKey } from "@bcwin/cache";

describe("Deep: FE rebate API surfaces (agency + history)", () => {
    const tracker = new FixtureTracker("rebfe");
    let uplineCookie: string;
    let uplineId: string;
    let bettorId: string;

    beforeAll(async () => {
        await ensureSystemConfig();
        const upline = await createTestUser(tracker, { balance: 0 });
        const bettor = await createTestUser(tracker, {
            balance: 5000,
            referredBy: upline.referralCode,
        });
        uplineId = upline.id;
        bettorId = bettor.id;
        uplineCookie = await authCookieFor(upline);

        await prisma.userVipLevel.upsert({
            where: { userId: uplineId },
            create: {
                userId: uplineId,
                currentLevel: 0, rebateLevel: 0,
                teamSize: 0,
                teamBetting: 0,
                teamDeposit: 0,
            },
            update: {},
        });

        await RebateCalculator.calculateTeamRebateForBet({
            bettorId,
            betAmount: 1000,
            game: "WINGO",
            betId: `fe-surface-${Date.now()}`,
        });
    });

    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
        });
    });

    test("GET /user/rebate/history returns accrued rows", async () => {
        const res = await get("/api/v1/user/rebate/history", {
            cookie: uplineCookie,
            query: { page: 1, limit: 50 },
        });
        expect(res.status).toBe(200);
        expect(res.json?.success).toBe(true);
        expect(Array.isArray(res.json?.data)).toBe(true);
        expect((res.json?.data?.length ?? 0) > 0).toBe(true);
        const row = res.json.data[0];
        expect(row.amount).toBeGreaterThan(0);
        expect(typeof row.settled).toBe("boolean");
    });

    test("GET /user/rebate/rates has lottery tables", async () => {
        const res = await get("/api/v1/user/rebate/rates", {
            cookie: uplineCookie,
        });
        expect(res.status).toBe(200);
        expect(res.json?.success).toBe(true);
        expect(Array.isArray(res.json?.data?.lottery)).toBe(true);
        expect((res.json?.data?.lottery?.length ?? 0) > 0).toBe(true);
    });

    test("GET /user/rebate/daily for today", async () => {
        const d = new Date();
        const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const res = await get("/api/v1/user/rebate/daily", {
            cookie: uplineCookie,
            query: { date: ymd },
        });
        expect(res.status).toBe(200);
        expect(res.json?.success).toBe(true);
        if (res.json?.data) {
            expect(res.json.data.settlementTime).toContain("01:30");
            expect(typeof res.json.data.totalCommission).toBe("number");
            expect(Array.isArray(res.json.data.categories)).toBe(true);
        }
    });

    test("GET /user/team/overview totalCommissionEarned uses settled rebates", async () => {
        // Unsettled only → lifetime may be 0 until settle
        const beforeSettle = await get("/api/v1/user/team/overview", {
            cookie: uplineCookie,
        });
        expect(beforeSettle.status).toBe(200);
        const earnedBefore = Number(
            beforeSettle.json?.data?.totalCommissionEarned ?? 0
        );

        await RebateCalculator.settleAllUnsettledRebates();
        // Overview is cached ~30s — bust before re-read
        await Cache.del(CacheKey.teamOverview(uplineId));

        const after = await get("/api/v1/user/team/overview", {
            cookie: uplineCookie,
        });
        expect(after.status).toBe(200);
        const earnedAfter = Number(
            after.json?.data?.totalCommissionEarned ?? 0
        );
        expect(earnedAfter).toBeGreaterThanOrEqual(earnedBefore);
        expect(earnedAfter).toBeGreaterThan(0);
    });

    test("legacy commission daily still responds (read-only, may be empty)", async () => {
        const res = await get("/api/v1/user/commission/daily", {
            cookie: uplineCookie,
            query: { page: 1, limit: 10 },
        });
        // Route still mounted for old clients; no new data required
        expect(res.status).toBeLessThan(500);
    });
});
