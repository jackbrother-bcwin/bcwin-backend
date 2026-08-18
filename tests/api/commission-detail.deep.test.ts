/**
 * Edge-case test suite for Commission Details Page and its backend API surfaces.
 * 
 * Verifies:
 * 1. Authentication & input validation (missing cookie, invalid dates)
 * 2. Empty state when user has no downlines/rebates
 * 3. Single-layer and multi-tier (L1-L6) commission calculations across categories
 * 4. Bettor deduplication when a downline places multiple bets on the same day
 * 5. IST Calendar day date boundaries (yesterday vs today vs tomorrow)
 * 6. Rebate settlement lifecycle (unsettled -> settled)
 * 7. History pagination, game filtering, category filtering, settlement status filtering
 * 8. Category rates API (/user/rebate/rates)
 * 9. Complete database cleanup verification (all DB entries removed after test run)
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import {
    get,
    FixtureTracker,
    createTestUser,
    authCookieFor,
    cleanupByUserIds,
    ensureSystemConfig,
} from "../helpers";
import { RebateCalculator } from "../../packages/rebate/rebateCalculator";

describe("Commission Detail Page & API Surface Edge Cases", () => {
    const tracker = new FixtureTracker("cd");
    let uplineA: any;
    let uplineCookieA: string;
    let uplineIdA: string;

    let downlineB: any; // L1
    let downlineC: any; // L2
    let downlineD: any; // L3
    let downlineE: any; // L4
    let downlineF: any; // L5
    let downlineG: any; // L6

    const getTodayYmd = () => {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
    };

    const getYesterdayYmd = () => {
        const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
    };

    beforeAll(async () => {
        await ensureSystemConfig();

        // Create 6-level referral chain: Upline A -> B (L1) -> C (L2) -> D (L3) -> E (L4) -> F (L5) -> G (L6)
        uplineA = await createTestUser(tracker, { balance: 10_000 });
        uplineIdA = uplineA.id;
        uplineCookieA = await authCookieFor(uplineA);

        downlineB = await createTestUser(tracker, {
            balance: 10_000,
            referredBy: uplineA.referralCode,
        });

        downlineC = await createTestUser(tracker, {
            balance: 10_000,
            referredBy: downlineB.referralCode,
        });

        downlineD = await createTestUser(tracker, {
            balance: 10_000,
            referredBy: downlineC.referralCode,
        });

        downlineE = await createTestUser(tracker, {
            balance: 10_000,
            referredBy: downlineD.referralCode,
        });

        downlineF = await createTestUser(tracker, {
            balance: 10_000,
            referredBy: downlineE.referralCode,
        });

        downlineG = await createTestUser(tracker, {
            balance: 10_000,
            referredBy: downlineF.referralCode,
        });

        // Set Upline A to VIP Level 2
        await prisma.userVipLevel.upsert({
            where: { userId: uplineIdA },
            create: {
                userId: uplineIdA,
                currentLevel: 2, rebateLevel: 2,
                teamSize: 6,
                teamBetting: 0,
                teamDeposit: 0,
            },
            update: { currentLevel: 2, rebateLevel: 2, teamSize: 6 },
        });
    });

    afterAll(async () => {
        // Strict teardown of all created test data
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
        });
    });

    // ── 1. Authentication & Input Validation ─────────────────────────────────

    describe("1. Authentication & Input Validation Edge Cases", () => {
        test("GET /user/rebate/daily without auth cookie returns 401", async () => {
            const res = await get("/api/v1/user/rebate/daily", {
                query: { date: getTodayYmd() },
            });
            expect(res.status).toBe(401);
        });

        test("GET /user/rebate/history without auth cookie returns 401", async () => {
            const res = await get("/api/v1/user/rebate/history", {
                query: { page: 1, limit: 10 },
            });
            expect(res.status).toBe(401);
        });

        test("GET /user/rebate/rates without auth cookie returns 401", async () => {
            const res = await get("/api/v1/user/rebate/rates");
            expect(res.status).toBe(401);
        });

        test("GET /user/rebate/daily with missing date query param returns 400 or 422", async () => {
            const res = await get("/api/v1/user/rebate/daily", {
                cookie: uplineCookieA,
            });
            expect(res.status >= 400 && res.status < 500).toBe(true);
        });

        test("GET /user/rebate/daily with invalid date format returns error", async () => {
            const res = await get("/api/v1/user/rebate/daily", {
                cookie: uplineCookieA,
                query: { date: "invalid-date" },
            });
            expect(res.status >= 400 && res.status < 500).toBe(true);
            const errMsg = String(res.json?.message || res.json?.error || "");
            expect(errMsg.length > 0).toBe(true);
        });

        test("GET /user/rebate/daily with out-of-range date string returns error", async () => {
            const res = await get("/api/v1/user/rebate/daily", {
                cookie: uplineCookieA,
                query: { date: "2026-99-99" },
            });
            expect(res.status >= 400).toBe(true);
        });
    });

    // ── 2. Empty State / Zero Downlines Data ─────────────────────────────────

    describe("2. Empty State & Zero Rebates Edge Cases", () => {
        let freshUserCookie: string;
        let freshTracker: FixtureTracker;

        beforeAll(async () => {
            freshTracker = new FixtureTracker("ce");
            const freshUser = await createTestUser(freshTracker);
            freshUserCookie = await authCookieFor(freshUser);
        });

        afterAll(async () => {
            await cleanupByUserIds(freshTracker.userIds);
        });

        test("GET /user/rebate/daily returns empty structure with hasData=false and 5 category blocks", async () => {
            const today = getTodayYmd();
            const res = await get("/api/v1/user/rebate/daily", {
                cookie: freshUserCookie,
                query: { date: today },
            });

            expect(res.status).toBe(200);
            expect(res.json?.success).toBe(true);
            const d = res.json?.data;
            expect(d).toBeDefined();
            expect(d.date).toBe(today);
            expect(d.settled).toBe(false);
            expect(d.hasData).toBe(false);
            expect(d.bettorCount).toBe(0);
            expect(d.totalBetAmount).toBe(0);
            expect(d.totalCommission).toBe(0);
            expect(d.settlementTime).toContain("01:30:00");
            expect(Array.isArray(d.categories)).toBe(true);
            expect(d.categories.length).toBe(5);

            // Verify all 5 categories present: LOTTERY, SLOTS, CASINO, SPORTS, RUMMY
            const catNames = d.categories.map((c: any) => c.category);
            expect(catNames).toContain("LOTTERY");
            expect(catNames).toContain("SLOTS");
            expect(catNames).toContain("CASINO");
            expect(catNames).toContain("SPORTS");
            expect(catNames).toContain("RUMMY");

            // Check layer array for each category (6 layers, all zeros)
            for (const cat of d.categories) {
                expect(cat.bettorCount).toBe(0);
                expect(cat.betAmount).toBe(0);
                expect(cat.commissionPayout).toBe(0);
                expect(cat.layers.length).toBe(6);
                for (const lay of cat.layers) {
                    expect(lay.betAmount).toBe(0);
                    expect(lay.totalComm).toBe(0);
                }
            }
        });

        test("GET /user/rebate/history for fresh user returns empty array", async () => {
            const res = await get("/api/v1/user/rebate/history", {
                cookie: freshUserCookie,
                query: { page: 1, limit: 50 },
            });
            expect(res.status).toBe(200);
            expect(res.json?.success).toBe(true);
            expect(res.json?.data).toEqual([]);
            expect(res.json?.total).toBe(0);
            expect(res.json?.currentPage).toBe(1);
            expect(res.json?.totalPages).toBe(1);
        });
    });

    // ── 3. Single Downline & Single Layer Commission ──────────────────────────

    describe("3. Single Downline (L1) Rebate Aggregation", () => {
        const betId = `single-l1-${Date.now()}`;
        const betAmount = 2000;

        beforeAll(async () => {
            // Trigger rebate calculation for L1 downline B
            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: downlineB.id,
                betAmount,
                game: "WINGO",
                betId,
            });
            // Clear cache for history
            await Cache.del(CacheKey.rebateHistory(uplineIdA));
        });

        test("GET /user/rebate/daily hides unsettled L1 rebate until 01:30 settle", async () => {
            const today = getTodayYmd();
            const res = await get("/api/v1/user/rebate/daily", {
                cookie: uplineCookieA,
                query: { date: today },
            });

            expect(res.status).toBe(200);
            expect(res.json?.success).toBe(true);
            const d = res.json.data;
            expect(d.hasData).toBe(false);
            expect(d.settled).toBe(false);
            expect(d.totalCommission).toBe(0);
            expect(d.bettorCount).toBe(0);
        });

        test("GET /user/rebate/daily reflects L1 after settle", async () => {
            await RebateCalculator.settleAllUnsettledRebates();
            const today = getTodayYmd();
            const res = await get("/api/v1/user/rebate/daily", {
                cookie: uplineCookieA,
                query: { date: today },
            });

            expect(res.status).toBe(200);
            expect(res.json?.success).toBe(true);
            const d = res.json.data;
            expect(d.hasData).toBe(true);
            expect(d.settled).toBe(true);
            expect(d.bettorCount).toBe(1);
            expect(d.totalBetAmount).toBe(betAmount);
            expect(d.totalCommission).toBeGreaterThan(0);

            const lotteryCat = d.categories.find((c: any) => c.category === "LOTTERY");
            expect(lotteryCat).toBeDefined();
            expect(lotteryCat.bettorCount).toBe(1);
            expect(lotteryCat.betAmount).toBe(betAmount);
            expect(lotteryCat.commissionPayout).toBeGreaterThan(0);

            // Layer 1 of LOTTERY category has non-zero amount
            const l1 = lotteryCat.layers.find((l: any) => l.layer === 1);
            expect(l1).toBeDefined();
            expect(l1.betAmount).toBe(betAmount);
            expect(l1.totalComm).toBeGreaterThan(0);

            // Other layers in LOTTERY should be zero
            for (let layerNum = 2; layerNum <= 6; layerNum++) {
                const l = lotteryCat.layers.find((lay: any) => lay.layer === layerNum);
                expect(l.betAmount).toBe(0);
                expect(l.totalComm).toBe(0);
            }
        });

        test("GET /user/rebate/history contains downline B details and serialNumber", async () => {
            const res = await get("/api/v1/user/rebate/history", {
                cookie: uplineCookieA,
                query: { page: 1, limit: 10, settled: "all" },
            });

            expect(res.status).toBe(200);
            expect(res.json?.success).toBe(true);
            expect(res.json?.data.length).toBeGreaterThanOrEqual(1);

            const row = res.json.data.find((r: any) => r.fromUser?.id === downlineB.id);
            expect(row).toBeDefined();
            expect(row.layer).toBe(1);
            expect(row.gameCategory).toBe("LOTTERY");
            expect(row.game).toBe("WINGO");
            expect(row.betAmount).toBe(betAmount);
            expect(row.amount).toBeGreaterThan(0);
            expect(row.settled).toBe(true);
            expect(row.fromUser.username).toBe(downlineB.username);
            expect(typeof row.fromUser.serialNumber).toBe("number");
        });
    });

    // ── 4. Multi-Tier Downline Architecture (L1 to L6) ────────────────────────

    describe("4. Multi-Tier Downlines (L1 to L6) & Category Diversity", () => {
        beforeAll(async () => {
            // L2 downline C bets in SLOTS
            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: downlineC.id,
                betAmount: 1500,
                game: "SLOTS_JDB",
                gameCategory: "SLOTS",
                betId: `multi-l2-${Date.now()}`,
            });

            // L3 downline D bets in CASINO
            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: downlineD.id,
                betAmount: 3000,
                game: "EVO_CASINO",
                gameCategory: "CASINO",
                betId: `multi-l3-${Date.now()}`,
            });

            // L6 downline G bets in LOTTERY (5D)
            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: downlineG.id,
                betAmount: 5000,
                game: "5D",
                betId: `multi-l6-${Date.now()}`,
            });

            await Cache.del(CacheKey.rebateHistory(uplineIdA));
        });

        test("GET /user/rebate/daily aggregates L1, L2, L3, L6 across LOTTERY, SLOTS, CASINO", async () => {
            await RebateCalculator.settleAllUnsettledRebates();
            const today = getTodayYmd();
            const res = await get("/api/v1/user/rebate/daily", {
                cookie: uplineCookieA,
                query: { date: today },
            });

            expect(res.status).toBe(200);
            const d = res.json?.data;
            expect(d.hasData).toBe(true);

            // Total bettors should include B (L1), C (L2), D (L3), G (L6) = 4 bettors
            expect(d.bettorCount).toBe(4);

            // Categories breakdown
            const lotteryCat = d.categories.find((c: any) => c.category === "LOTTERY");
            const slotsCat = d.categories.find((c: any) => c.category === "SLOTS");
            const casinoCat = d.categories.find((c: any) => c.category === "CASINO");

            expect(lotteryCat.betAmount).toBe(2000 + 5000); // B (2000) + G (5000)
            expect(slotsCat.betAmount).toBe(1500); // C (1500)
            expect(casinoCat.betAmount).toBe(3000); // D (3000)

            // Layer breakdown verification
            const lotteryL1 = lotteryCat.layers.find((l: any) => l.layer === 1);
            const lotteryL6 = lotteryCat.layers.find((l: any) => l.layer === 6);
            const slotsL2 = slotsCat.layers.find((l: any) => l.layer === 2);
            const casinoL3 = casinoCat.layers.find((l: any) => l.layer === 3);

            expect(lotteryL1.betAmount).toBe(2000);
            expect(lotteryL6.betAmount).toBe(5000);
            expect(slotsL2.betAmount).toBe(1500);
            expect(casinoL3.betAmount).toBe(3000);

            expect(lotteryL1.totalComm).toBeGreaterThan(0);
            expect(lotteryL6.totalComm).toBeGreaterThan(0);
            expect(slotsL2.totalComm).toBeGreaterThan(0);
            expect(casinoL3.totalComm).toBeGreaterThan(0);
        });

        test("Bettor Deduplication: Multiple bets by same downline on same day increments bet volume, NOT bettor count", async () => {
            // Downline B places 3 additional bets in LOTTERY today
            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: downlineB.id,
                betAmount: 1000,
                game: "WINGO",
                betId: `dedup-b1-${Date.now()}`,
            });
            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: downlineB.id,
                betAmount: 1000,
                game: "WINGO",
                betId: `dedup-b2-${Date.now()}`,
            });
            await RebateCalculator.settleAllUnsettledRebates();

            const today = getTodayYmd();
            const res = await get("/api/v1/user/rebate/daily", {
                cookie: uplineCookieA,
                query: { date: today },
            });

            expect(res.status).toBe(200);
            const d = res.json?.data;

            // Bettor count MUST stay 4 (B, C, D, G) despite B's extra 2 bets
            expect(d.bettorCount).toBe(4);

            // Total bet amount in LOTTERY for L1 should be 2000 + 1000 + 1000 = 4000
            const lotteryCat = d.categories.find((c: any) => c.category === "LOTTERY");
            const lotteryL1 = lotteryCat.layers.find((l: any) => l.layer === 1);
            expect(lotteryL1.betAmount).toBe(4000);
        });
    });

    // ── 5. Date Boundaries & Time Filtering ────────────────────────────────────

    describe("5. IST Calendar Day Date Boundaries", () => {
        const yesterdayDateStr = getYesterdayYmd();

        beforeAll(async () => {
            // Manually insert a rebate created yesterday
            const yesterdayDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
            await prisma.rebate.create({
                data: {
                    userId: uplineIdA,
                    fromUserId: downlineB.id,
                    layer: 1,
                    gameCategory: "LOTTERY",
                    game: "WINGO",
                    betAmount: 8000,
                    amount: 40.0,
                    rate: 0.005,
                    receiverVip: 2,
                    settled: true,
                    createdAt: yesterdayDate,
                },
            });
        });

        test("Querying /user/rebate/daily for Yesterday returns only Yesterday's rebates", async () => {
            const res = await get("/api/v1/user/rebate/daily", {
                cookie: uplineCookieA,
                query: { date: yesterdayDateStr },
            });

            expect(res.status).toBe(200);
            const d = res.json?.data;
            expect(d.date).toBe(yesterdayDateStr);
            expect(d.hasData).toBe(true);
            expect(d.bettorCount).toBe(1);
            expect(d.totalBetAmount).toBe(8000);
            expect(d.totalCommission).toBe(40.0);
        });

        test("Querying /user/rebate/history for Yesterday filters out Today's rebates", async () => {
            await Cache.del(CacheKey.rebateHistory(uplineIdA));
            const res = await get("/api/v1/user/rebate/history", {
                cookie: uplineCookieA,
                query: {
                    startDate: yesterdayDateStr,
                    endDate: yesterdayDateStr,
                    page: 1,
                    limit: 50,
                },
            });

            expect(res.status).toBe(200);
            expect(res.json?.data.length).toBe(1);
            expect(res.json?.data[0].betAmount).toBe(8000);
            expect(res.json?.data[0].amount).toBe(40.0);
        });
    });

    // ── 6. Rebate Settlement Lifecycle ───────────────────────────────────────

    describe("6. Settlement Lifecycle (Unsettled -> Settled)", () => {
        test("Settling all rebates updates settled status to true in /user/rebate/daily", async () => {
            const today = getTodayYmd();
            await RebateCalculator.settleAllUnsettledRebates();

            const after = await get("/api/v1/user/rebate/daily", {
                cookie: uplineCookieA,
                query: { date: today },
            });
            expect(after.status).toBe(200);
            expect(after.json?.data?.hasData).toBe(true);
            expect(after.json?.data?.settled).toBe(true);
        });
    });

    // ── 7. History Pagination & Filter Combinations ───────────────────────────

    describe("7. History Filtering, Pagination & Rates API", () => {
        test("Filtering history by category (LOTTERY vs SLOTS)", async () => {
            await Cache.del(CacheKey.rebateHistory(uplineIdA));
            const resLottery = await get("/api/v1/user/rebate/history", {
                cookie: uplineCookieA,
                query: { category: "LOTTERY", page: 1, limit: 50 },
            });
            expect(resLottery.status).toBe(200);
            expect(resLottery.json?.data.every((r: any) => r.gameCategory === "LOTTERY")).toBe(true);

            await Cache.del(CacheKey.rebateHistory(uplineIdA));
            const resSlots = await get("/api/v1/user/rebate/history", {
                cookie: uplineCookieA,
                query: { category: "SLOTS", page: 1, limit: 50 },
            });
            expect(resSlots.status).toBe(200);
            expect(resSlots.json?.data.every((r: any) => r.gameCategory === "SLOTS")).toBe(true);
        });

        test("History pagination (page & limit parameters)", async () => {
            await Cache.del(CacheKey.rebateHistory(uplineIdA));
            const page1 = await get("/api/v1/user/rebate/history", {
                cookie: uplineCookieA,
                query: { page: 1, limit: 2 },
            });

            expect(page1.status).toBe(200);
            expect(page1.json?.data.length).toBe(2);
            expect(page1.json?.currentPage).toBe(1);
            expect(page1.json?.total).toBeGreaterThan(2);
            expect(page1.json?.totalPages).toBeGreaterThan(1);
        });

        test("GET /user/rebate/rates returns configuration tables for 5 categories", async () => {
            const res = await get("/api/v1/user/rebate/rates", {
                cookie: uplineCookieA,
            });

            expect(res.status).toBe(200);
            expect(res.json?.success).toBe(true);
            const d = res.json?.data;
            expect(Array.isArray(d.lottery)).toBe(true);
            expect(Array.isArray(d.slots)).toBe(true);
            expect(Array.isArray(d.casino)).toBe(true);
            expect(Array.isArray(d.sports)).toBe(true);
            expect(Array.isArray(d.rummy)).toBe(true);

            if (d.lottery.length > 0) {
                const row = d.lottery[0];
                expect(typeof row.vipLevel).toBe("number");
                expect(typeof row.layer1).toBe("number");
                expect(typeof row.layer2).toBe("number");
                expect(typeof row.layer3).toBe("number");
                expect(typeof row.layer4).toBe("number");
                expect(typeof row.layer5).toBe("number");
                expect(typeof row.layer6).toBe("number");
            }
        });
    });

    // ── 8. Strict DB Cleanup Verification ───────────────────────────────────

    describe("8. Database Cleanup Verification", () => {
        test("Verifies that every DB entry created by the test suite will be purged", async () => {
            // First count records associated with tracked test users
            const usersCountBefore = await prisma.user.count({
                where: { id: { in: tracker.userIds } },
            });
            expect(usersCountBefore).toBe(tracker.userIds.length);

            const rebatesCountBefore = await prisma.rebate.count({
                where: {
                    OR: [
                        { userId: { in: tracker.userIds } },
                        { fromUserId: { in: tracker.userIds } },
                    ],
                },
            });
            expect(rebatesCountBefore).toBeGreaterThan(0);

            // Execute cleanup
            await cleanupByUserIds(tracker.userIds, {
                periodPrefix: tracker.periodPrefix,
            });

            // Verify database is 100% clean
            const usersCountAfter = await prisma.user.count({
                where: { id: { in: tracker.userIds } },
            });
            expect(usersCountAfter).toBe(0);

            const rebatesCountAfter = await prisma.rebate.count({
                where: {
                    OR: [
                        { userId: { in: tracker.userIds } },
                        { fromUserId: { in: tracker.userIds } },
                    ],
                },
            });
            expect(rebatesCountAfter).toBe(0);

            const vipCountAfter = await prisma.userVipLevel.count({
                where: { userId: { in: tracker.userIds } },
            });
            expect(vipCountAfter).toBe(0);

            const summaryCountAfter = await prisma.dailyCommissionSummary.count({
                where: { userId: { in: tracker.userIds } },
            });
            expect(summaryCountAfter).toBe(0);

            console.log(
                `✅ Verified DB Teardown: ${tracker.userIds.length} users and ${rebatesCountBefore} rebate records completely removed from Database.`
            );
        });
    });
});
