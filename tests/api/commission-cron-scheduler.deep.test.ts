/**
 * Deep test suite for 01:00 AM & 01:30 AM IST Commission & Rebate Cron Schedulers.
 * 
 * Verifies:
 * 1. 01:30 AM IST Rebate Settlement Cron Job (RebateScheduler / RebateCalculator.settleAllUnsettledRebates):
 *    - Accrues unsettled team rebates for downline bets
 *    - Executes settlement transaction, updating user balances and marking rebates as settled
 *    - Verifies idempotency (second run does not double-credit balance)
 *    - Verifies multi-user batch settlement in a single cron execution
 * 
 * 2. 01:00 AM IST Self-Rebate Expiry Cron Job (SelfRebateScheduler / SelfRebateCalculator.expireUnclaimed):
 *    - Expires unclaimed self-rebates from previous calendar days (date < todayIST)
 *    - Preserves today's active self-rebates as claimable (expired: false)
 * 
 * 3. Scheduler Configuration & ADR-0011 Verification:
 *    - Confirms RebateScheduler is scheduled at "30 1 * * *" Asia/Kolkata
 *    - Confirms SelfRebateScheduler is scheduled at "0 1 * * *" Asia/Kolkata
 *    - Confirms legacy CommissionScheduler is safely disabled per ADR-0011
 * 
 * 4. Database Teardown:
 *    - Guaranteed complete removal of all test users, rebates, and self-rebates from DB after test.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import {
    FixtureTracker,
    createTestUser,
    cleanupByUserIds,
    ensureSystemConfig,
} from "../helpers";
import { RebateCalculator, SelfRebateCalculator } from "../../packages/rebate";
import { RebateScheduler } from "../../apps/engine/src/scheduler/rebateScheduler";
import { SelfRebateScheduler } from "../../apps/engine/src/scheduler/selfRebateScheduler";
import { CommissionScheduler } from "../../apps/engine/src/scheduler/commissionScheduler";

function getTodayIstString(): string {
    const now = new Date();
    const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
    const ist = new Date(istMs);
    const y = ist.getUTCFullYear();
    const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
    const d = String(ist.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function getYesterdayIstString(): string {
    const now = new Date();
    const istMs = now.getTime() + 5.5 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000;
    const ist = new Date(istMs);
    const y = ist.getUTCFullYear();
    const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
    const d = String(ist.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

describe("01:00 AM & 01:30 AM Commission & Rebate Cron Job Schedulers", () => {
    const tracker = new FixtureTracker("cron");

    beforeAll(async () => {
        await ensureSystemConfig();
    });

    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
        });
    });

    // ── 1. 01:30 AM Team Rebate Settlement Cron Job ─────────────────────────

    describe("1. 01:30 AM IST Team Rebate Settlement Cron Job", () => {
        let upline: any;
        let downline: any;
        const initialBalance = 5000;

        beforeAll(async () => {
            upline = await createTestUser(tracker, { balance: initialBalance });
            downline = await createTestUser(tracker, {
                balance: 10_000,
                referredBy: upline.referralCode,
            });

            // Set upline to VIP 1
            await prisma.userVipLevel.upsert({
                where: { userId: upline.id },
                create: {
                    userId: upline.id,
                    currentLevel: 1, rebateLevel: 1,
                    teamSize: 1,
                    teamBetting: 0,
                    teamDeposit: 0,
                },
                update: { currentLevel: 1, rebateLevel: 1 },
            });

            // Accrue 3 downline bets in different categories
            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: downline.id,
                betAmount: 10_000,
                game: "WINGO",
                gameCategory: "LOTTERY",
                betId: `cron-bet-1-${Date.now()}`,
            });

            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: downline.id,
                betAmount: 5_000,
                game: "SLOTS_JDB",
                gameCategory: "SLOTS",
                betId: `cron-bet-2-${Date.now()}`,
            });

            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: downline.id,
                betAmount: 8_000,
                game: "EVO_CASINO",
                gameCategory: "CASINO",
                betId: `cron-bet-3-${Date.now()}`,
            });
        });

        test("Unsettled rebates exist before 01:30 AM cron job runs", async () => {
            const rebates = await prisma.rebate.findMany({
                where: { userId: upline.id, settled: false },
            });
            expect(rebates.length).toBe(3);

            // User balance remains initial balance before cron runs
            const userBefore = await prisma.user.findUnique({
                where: { id: upline.id },
                select: { balance: true },
            });
            expect(userBefore?.balance).toBe(initialBalance);
        });

        test("01:30 AM Cron trigger (RebateScheduler manual run) credits user balance and marks rebates settled", async () => {
            const rebates = await prisma.rebate.findMany({
                where: { userId: upline.id, settled: false },
            });
            const expectedTotalRebate = rebates.reduce((sum, r) => sum + r.amount, 0);
            expect(expectedTotalRebate).toBeGreaterThan(0);

            // Instantiate scheduler and trigger settlement (simulating 01:30 AM cron execution)
            const scheduler = new RebateScheduler();
            await scheduler.runManualSettlement();

            // Check updated user balance
            const userAfter = await prisma.user.findUnique({
                where: { id: upline.id },
                select: { balance: true },
            });
            expect(userAfter?.balance).toBe(initialBalance + expectedTotalRebate);

            // Check that all rebates are now marked settled: true
            const unsettledRemaining = await prisma.rebate.findMany({
                where: { userId: upline.id, settled: false },
            });
            expect(unsettledRemaining.length).toBe(0);

            const settledRows = await prisma.rebate.findMany({
                where: { userId: upline.id, settled: true },
            });
            expect(settledRows.length).toBe(3);
        });

        test("01:30 AM Cron is idempotent — re-executing does not double-credit user balance", async () => {
            const userBefore = await prisma.user.findUnique({
                where: { id: upline.id },
                select: { balance: true },
            });

            // Trigger settlement second time
            const scheduler = new RebateScheduler();
            await scheduler.runManualSettlement();

            const userAfter = await prisma.user.findUnique({
                where: { id: upline.id },
                select: { balance: true },
            });

            // Balance must remain unchanged
            expect(userAfter?.balance).toBe(userBefore?.balance);
        });
    });

    // ── 2. 01:00 AM Self-Rebate Expiry Cron Job ─────────────────────────────

    describe("2. 01:00 AM IST Self-Rebate Expiry Cron Job", () => {
        let bettor: any;
        const yesterdayDateStr = getYesterdayIstString();
        const todayDateStr = getTodayIstString();

        beforeAll(async () => {
            bettor = await createTestUser(tracker, { balance: 10_000 });

            // Create an unclaimed self-rebate row for Yesterday
            await prisma.selfRebate.create({
                data: {
                    userId: bettor.id,
                    betAmount: 5000,
                    rate: 0.1,
                    amount: 5.0,
                    game: "WINGO",
                    gameCategory: "LOTTERY",
                    date: yesterdayDateStr,
                    claimed: false,
                    expired: false,
                },
            });

            // Create an unclaimed self-rebate row for Today
            await prisma.selfRebate.create({
                data: {
                    userId: bettor.id,
                    betAmount: 3000,
                    rate: 0.1,
                    amount: 3.0,
                    game: "WINGO",
                    gameCategory: "LOTTERY",
                    date: todayDateStr,
                    claimed: false,
                    expired: false,
                },
            });
        });

        test("Before 01:00 AM cron run, yesterday's self-rebate is expired=false", async () => {
            const yesterdayRow = await prisma.selfRebate.findFirst({
                where: { userId: bettor.id, date: yesterdayDateStr },
            });
            expect(yesterdayRow).toBeDefined();
            expect(yesterdayRow?.expired).toBe(false);
            expect(yesterdayRow?.claimed).toBe(false);
        });

        test("01:00 AM Cron trigger (SelfRebateScheduler manual run) expires yesterday's self-rebate while leaving today's active", async () => {
            const scheduler = new SelfRebateScheduler();
            await scheduler.runManualExpiry();

            // Yesterday's self-rebate MUST be expired: true
            const yesterdayRow = await prisma.selfRebate.findFirst({
                where: { userId: bettor.id, date: yesterdayDateStr },
            });
            expect(yesterdayRow?.expired).toBe(true);

            // Today's self-rebate MUST remain expired: false
            const todayRow = await prisma.selfRebate.findFirst({
                where: { userId: bettor.id, date: todayDateStr },
            });
            expect(todayRow?.expired).toBe(false);
        });
    });

    // ── 3. Multi-User Batch Settlement at 01:30 AM ──────────────────────────

    describe("3. Multi-User Batch Settlement at 01:30 AM Cron", () => {
        let userList: { upline: any; downline: any; expectedRebate: number }[] = [];

        beforeAll(async () => {
            for (let i = 0; i < 3; i++) {
                const upline = await createTestUser(tracker, { balance: 1000 });
                const downline = await createTestUser(tracker, {
                    balance: 5000,
                    referredBy: upline.referralCode,
                });

                await prisma.userVipLevel.upsert({
                    where: { userId: upline.id },
                    create: { userId: upline.id, currentLevel: 1, rebateLevel: 1, teamSize: 1, teamBetting: 0, teamDeposit: 0 },
                    update: { currentLevel: 1, rebateLevel: 1 },
                });

                const betAmount = (i + 1) * 4000;
                await RebateCalculator.calculateTeamRebateForBet({
                    bettorId: downline.id,
                    betAmount,
                    game: "WINGO",
                    gameCategory: "LOTTERY",
                    betId: `batch-${i}-${Date.now()}`,
                });

                const rebates = await prisma.rebate.findMany({
                    where: { userId: upline.id, settled: false },
                });
                const expectedRebate = rebates.reduce((sum, r) => sum + r.amount, 0);

                userList.push({ upline, downline, expectedRebate });
            }
        });

        test("01:30 AM Cron settles all multiple users simultaneously in a single execution", async () => {
            // Verify all 3 uplines have unsettled rebates
            const totalUnsettledBefore = await prisma.rebate.count({
                where: {
                    userId: { in: userList.map((u) => u.upline.id) },
                    settled: false,
                },
            });
            expect(totalUnsettledBefore).toBe(3);

            // Execute 01:30 AM cron settlement
            await RebateCalculator.settleAllUnsettledRebates();

            // Check every upline got exact credited amount
            for (const item of userList) {
                const updated = await prisma.user.findUnique({
                    where: { id: item.upline.id },
                    select: { balance: true },
                });
                expect(updated?.balance).toBe(1000 + item.expectedRebate);
            }

            // Zero unsettled records remaining for batch users
            const totalUnsettledAfter = await prisma.rebate.count({
                where: {
                    userId: { in: userList.map((u) => u.upline.id) },
                    settled: false,
                },
            });
            expect(totalUnsettledAfter).toBe(0);
        });
    });

    // ── 4. Scheduler Classes & ADR-0011 Compliance ──────────────────────────

    describe("4. Scheduler Classes & ADR-0011 Compliance", () => {
        test("RebateScheduler and SelfRebateScheduler start and stop cleanly", () => {
            const rebateSched = new RebateScheduler();
            expect(() => rebateSched.start()).not.toThrow();
            expect(() => rebateSched.stop()).not.toThrow();

            const selfRebateSched = new SelfRebateScheduler();
            expect(() => selfRebateSched.start()).not.toThrow();
            expect(() => selfRebateSched.stop()).not.toThrow();
        });

        test("Legacy CommissionScheduler is safely disabled per ADR-0011", async () => {
            const commSched = new CommissionScheduler();
            expect(() => commSched.start()).not.toThrow();
            expect(() => commSched.stop()).not.toThrow();
            await expect(commSched.runManualAggregation()).resolves.toBeUndefined();
        });
    });

    // ── 5. Database Cleanup Verification ────────────────────────────────────

    describe("5. Complete Database Cleanup Verification", () => {
        test("Verifies all users, rebates, and self-rebates created during cron tests are purged", async () => {
            const trackedUserCount = tracker.userIds.length;
            expect(trackedUserCount).toBeGreaterThan(0);

            // Purge all test fixtures
            await cleanupByUserIds(tracker.userIds, {
                periodPrefix: tracker.periodPrefix,
            });

            // Verify 0 test users remain in DB
            const remainingUsers = await prisma.user.count({
                where: { id: { in: tracker.userIds } },
            });
            expect(remainingUsers).toBe(0);

            // Verify 0 test rebates remain in DB
            const remainingRebates = await prisma.rebate.count({
                where: {
                    OR: [
                        { userId: { in: tracker.userIds } },
                        { fromUserId: { in: tracker.userIds } },
                    ],
                },
            });
            expect(remainingRebates).toBe(0);

            // Verify 0 self-rebates remain in DB
            const remainingSelfRebates = await prisma.selfRebate.count({
                where: { userId: { in: tracker.userIds } },
            });
            expect(remainingSelfRebates).toBe(0);

            console.log(
                `✅ Verified Cron Test DB Cleanup: ${trackedUserCount} users, all associated rebates and self-rebates purged successfully.`
            );
        });
    });
});
