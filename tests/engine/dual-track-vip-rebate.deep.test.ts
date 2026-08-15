/**
 * ADR-0012 dual-track deep suite — XP VIP vs rebate level edge cases.
 *
 * Covers:
 * 1. Independence (high XP / low team, high team / low XP)
 * 2. XP thresholds (exact boundary, just under, multi-level jump)
 * 3. Sticky XP VIP (no demotion)
 * 4. Rebate AND-gate (each metric missing fails; all three pass)
 * 5. Sticky rebate level (no demotion after metrics drop)
 * 6. RebateCalculator reads rebateLevel only (not currentLevel)
 * 7. recomputeUnsettledRebateReceiverLevels
 * 8. API /user/vip/status + claim use XP VIP only
 * 9. Place-bet HTTP path syncs XP VIP, not rebateLevel
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "@bcwin/db";
import {
    FixtureTracker,
    createTestUser,
    authCookieFor,
    cleanupByUserIds,
    ensureSystemConfig,
    createActiveWingoPeriod,
    get,
    post,
} from "../helpers";
import { seedVipRequirements } from "../../packages/db/seeds/vipRequirements";
import { seedRebateRates } from "../../packages/db/seeds/rebateRates";
import { VipLevelService } from "../../apps/engine/src/services/vip/vipLevelService";
import { RebateCalculator } from "../../packages/rebate/rebateCalculator";

/** Short unique username (fixture usernames max ~28 chars; long runId truncates). */
function uname(tag: string) {
    return `d_${tag}_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 6)}`.slice(0, 28);
}

describe("Deep: dual-track XP VIP vs rebate level (ADR-0012)", () => {
    const tracker = new FixtureTracker("dualvip");
    let userId: string;
    let cookie: string;
    let referralCode: string;

    beforeAll(async () => {
        await ensureSystemConfig();
        await seedVipRequirements();
        await seedRebateRates(prisma as any);
        const u = await createTestUser(tracker, {
            balance: 100_000,
            username: uname("main"),
        });
        userId = u.id;
        referralCode = u.referralCode;
        cookie = await authCookieFor(u);
        await prisma.userVipLevel.upsert({
            where: { userId },
            create: {
                userId,
                currentLevel: 0,
                rebateLevel: 0,
                teamSize: 0,
                teamBetting: 0,
                teamDeposit: 0,
            },
            update: {
                currentLevel: 0,
                rebateLevel: 0,
                teamSize: 0,
                teamBetting: 0,
                teamDeposit: 0,
            },
        });
        await prisma.user.update({
            where: { id: userId },
            data: { xp: 0 },
        });
    });

    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
        });
    });

    // ── 1. XP ladder ────────────────────────────────────────────────────────

    describe("1. XP VIP ladder (currentLevel)", () => {
        test("exactly expRequired (3000) unlocks XP VIP 1", async () => {
            await prisma.user.update({
                where: { id: userId },
                data: { xp: 3000 },
            });
            await prisma.userVipLevel.update({
                where: { userId },
                data: { currentLevel: 0 },
            });
            const lvl = await VipLevelService.syncLevelFromXp(userId);
            expect(lvl).toBe(1);
        });

        test("just under threshold (2999) stays XP VIP 0 if never unlocked", async () => {
            const orphan = await createTestUser(tracker, {
                balance: 1000,
                username: uname("u2999"),
            });
            await prisma.user.update({
                where: { id: orphan.id },
                data: { xp: 2999 },
            });
            await prisma.userVipLevel.upsert({
                where: { userId: orphan.id },
                create: {
                    userId: orphan.id,
                    currentLevel: 0,
                    rebateLevel: 0,
                    teamSize: 0,
                    teamBetting: 0,
                    teamDeposit: 0,
                },
                update: { currentLevel: 0 },
            });
            const lvl = await VipLevelService.syncLevelFromXp(orphan.id);
            expect(lvl).toBe(0);
        });

        test("XP 30000 jumps to XP VIP 2 in one sync", async () => {
            const u = await createTestUser(tracker, {
                balance: 1000,
                username: uname("xp2"),
            });
            await prisma.user.update({
                where: { id: u.id },
                data: { xp: 30_000 },
            });
            await prisma.userVipLevel.upsert({
                where: { userId: u.id },
                create: {
                    userId: u.id,
                    currentLevel: 0,
                    rebateLevel: 0,
                    teamSize: 0,
                    teamBetting: 0,
                    teamDeposit: 0,
                },
                update: { currentLevel: 0, rebateLevel: 0 },
            });
            const lvl = await VipLevelService.syncLevelFromXp(u.id);
            expect(lvl).toBe(2);
            const row = await prisma.userVipLevel.findUniqueOrThrow({
                where: { userId: u.id },
            });
            expect(row.rebateLevel).toBe(0);
        });

        test("sticky: XP VIP does not fall when XP drops", async () => {
            await prisma.user.update({
                where: { id: userId },
                data: { xp: 0 },
            });
            // userId was already VIP1 from first test
            const lvl = await VipLevelService.syncLevelFromXp(userId);
            expect(lvl).toBeGreaterThanOrEqual(1);
            const row = await prisma.userVipLevel.findUniqueOrThrow({
                where: { userId },
            });
            expect(row.currentLevel).toBeGreaterThanOrEqual(1);
        });

        test("high XP never raises rebateLevel by itself", async () => {
            const u = await createTestUser(tracker, {
                balance: 1000,
                username: uname("hipxp"),
            });
            await prisma.user.update({
                where: { id: u.id },
                data: { xp: 10_000_000 },
            });
            await prisma.userVipLevel.upsert({
                where: { userId: u.id },
                create: {
                    userId: u.id,
                    currentLevel: 0,
                    rebateLevel: 0,
                    teamSize: 0,
                    teamBetting: 0,
                    teamDeposit: 0,
                },
                update: { currentLevel: 0, rebateLevel: 0 },
            });
            await VipLevelService.syncLevelFromXp(u.id);
            const row = await prisma.userVipLevel.findUniqueOrThrow({
                where: { userId: u.id },
            });
            expect(row.currentLevel).toBeGreaterThanOrEqual(4);
            expect(row.rebateLevel).toBe(0);
        });
    });

    // ── 2. Rebate AND-gate ──────────────────────────────────────────────────

    describe("2. Rebate level AND-gate (team metrics)", () => {
        const L1 = {
            teamSize: 10,
            teamBetting: 50_000,
            teamDeposit: 10_000,
        };

        test("all three metrics at L1 → qualify 1", async () => {
            const q =
                await VipLevelService.calculateRebateLevelFromMetrics(L1);
            expect(q).toBe(1);
        });

        test("missing teamSize fails L1", async () => {
            const q = await VipLevelService.calculateRebateLevelFromMetrics({
                ...L1,
                teamSize: 9,
            });
            expect(q).toBe(0);
        });

        test("missing teamBetting fails L1", async () => {
            const q = await VipLevelService.calculateRebateLevelFromMetrics({
                ...L1,
                teamBetting: 49_999,
            });
            expect(q).toBe(0);
        });

        test("missing teamDeposit fails L1", async () => {
            const q = await VipLevelService.calculateRebateLevelFromMetrics({
                ...L1,
                teamDeposit: 9_999,
            });
            expect(q).toBe(0);
        });

        test("exact L2 thresholds qualify 2", async () => {
            const q = await VipLevelService.calculateRebateLevelFromMetrics({
                teamSize: 30,
                teamBetting: 200_000,
                teamDeposit: 50_000,
            });
            expect(q).toBe(2);
        });

        test("metrics between L1 and L2 stay at 1", async () => {
            const q = await VipLevelService.calculateRebateLevelFromMetrics({
                teamSize: 20,
                teamBetting: 100_000,
                teamDeposit: 20_000,
            });
            expect(q).toBe(1);
        });

        test("zero metrics → rebate 0", async () => {
            const q = await VipLevelService.calculateRebateLevelFromMetrics({
                teamSize: 0,
                teamBetting: 0,
                teamDeposit: 0,
            });
            expect(q).toBe(0);
        });
    });

    // ── 3. Sticky rebate + full update ──────────────────────────────────────

    describe("3. Sticky rebateLevel on full updateUserVipLevel", () => {
        let stickyUser: string;

        beforeAll(async () => {
            const u = await createTestUser(tracker, {
                balance: 1000,
                username: uname("sticky"),
            });
            stickyUser = u.id;
            // Seed high rebate level artificially
            await prisma.userVipLevel.upsert({
                where: { userId: stickyUser },
                create: {
                    userId: stickyUser,
                    currentLevel: 0,
                    rebateLevel: 3,
                    teamSize: 80,
                    teamBetting: 800_000,
                    teamDeposit: 200_000,
                },
                update: {
                    currentLevel: 0,
                    rebateLevel: 3,
                },
            });
            // Empty team tree → qualified rebate = 0, but sticky keeps 3
            await prisma.teamMetrics.upsert({
                where: { userId: stickyUser },
                create: {
                    userId: stickyUser,
                    directTeamSize: 0,
                    directTeamBetting: 0,
                    directTeamDeposit: 0,
                    totalTeamSize: 0,
                    totalTeamBetting: 0,
                    totalTeamDeposit: 0,
                },
                update: {
                    totalTeamSize: 0,
                    totalTeamBetting: 0,
                    totalTeamDeposit: 0,
                },
            });
        });

        test("full update with empty team does not demote rebateLevel", async () => {
            // skipTeamMetrics so we don't rebuild tree; still applies sticky max
            const before = await prisma.userVipLevel.findUniqueOrThrow({
                where: { userId: stickyUser },
            });
            expect(before.rebateLevel).toBe(3);

            // Force metrics to zero in DB, then update with skipTeamMetrics false
            // will recompute empty tree → qualified 0 → sticky max(3,0)=3
            const result = await VipLevelService.updateUserVipLevel(
                stickyUser,
                { skipTeamMetrics: false }
            );
            expect(result.rebateLevel).toBe(3);

            const after = await prisma.userVipLevel.findUniqueOrThrow({
                where: { userId: stickyUser },
            });
            expect(after.rebateLevel).toBe(3);
        });

        test("syncLevelFromXp never changes rebateLevel", async () => {
            await prisma.user.update({
                where: { id: stickyUser },
                data: { xp: 5000 },
            });
            await VipLevelService.syncLevelFromXp(stickyUser);
            const row = await prisma.userVipLevel.findUniqueOrThrow({
                where: { userId: stickyUser },
            });
            expect(row.currentLevel).toBeGreaterThanOrEqual(1);
            expect(row.rebateLevel).toBe(3);
        });
    });

    // ── 4. RebateCalculator rate source ─────────────────────────────────────

    describe("4. RebateCalculator uses rebateLevel only", () => {
        test("XP VIP high + rebateLevel 0 → L0 rates (0.5%)", async () => {
            const up = await createTestUser(tracker, {
                balance: 0,
                username: uname("r0up"),
            });
            await prisma.userVipLevel.upsert({
                where: { userId: up.id },
                create: {
                    userId: up.id,
                    currentLevel: 5,
                    rebateLevel: 0,
                    teamSize: 0,
                    teamBetting: 0,
                    teamDeposit: 0,
                },
                update: { currentLevel: 5, rebateLevel: 0 },
            });
            const dl = await createTestUser(tracker, {
                balance: 20_000,
                referredBy: up.referralCode,
                username: uname("r0dl"),
            });
            const betId = `edge-r0-${Date.now()}`;
            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: dl.id,
                betAmount: 10_000,
                game: "WINGO",
                gameCategory: "LOTTERY",
                betId,
            });
            const row = await prisma.rebate.findFirst({
                where: { betId, userId: up.id },
            });
            expect(row?.receiverVip).toBe(0);
            expect(row?.rate).toBeCloseTo(0.5, 5);
            expect(row?.amount).toBeCloseTo(50, 4);
        });

        test("rebateLevel 1 + XP VIP 0 → L1 rates (0.6%)", async () => {
            const up = await createTestUser(tracker, {
                balance: 0,
                username: uname("r1up"),
            });
            await prisma.userVipLevel.upsert({
                where: { userId: up.id },
                create: {
                    userId: up.id,
                    currentLevel: 0,
                    rebateLevel: 1,
                    teamSize: 10,
                    teamBetting: 50_000,
                    teamDeposit: 10_000,
                },
                update: { currentLevel: 0, rebateLevel: 1 },
            });
            const dl = await createTestUser(tracker, {
                balance: 20_000,
                referredBy: up.referralCode,
                username: uname("r1dl"),
            });
            const betId = `edge-r1-${Date.now()}`;
            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: dl.id,
                betAmount: 10_000,
                game: "WINGO",
                gameCategory: "LOTTERY",
                betId,
            });
            const row = await prisma.rebate.findFirst({
                where: { betId, userId: up.id },
            });
            expect(row?.receiverVip).toBe(1);
            expect(row?.rate).toBeCloseTo(0.6, 5);
            expect(row?.amount).toBeCloseTo(60, 4);
        });
    });

    // ── 5. Unsettled recompute ──────────────────────────────────────────────

    describe("5. recomputeUnsettledRebateReceiverLevels", () => {
        test("updates open rows when rebateLevel changes; leaves settled alone", async () => {
            const up = await createTestUser(tracker, {
                balance: 1000,
                username: uname("rcup"),
            });
            await prisma.userVipLevel.upsert({
                where: { userId: up.id },
                create: {
                    userId: up.id,
                    currentLevel: 0,
                    rebateLevel: 0,
                    teamSize: 0,
                    teamBetting: 0,
                    teamDeposit: 0,
                },
                update: { rebateLevel: 0, currentLevel: 0 },
            });
            const dl = await createTestUser(tracker, {
                balance: 5000,
                referredBy: up.referralCode,
                username: uname("rcdl"),
            });

            const openId = `open-${Date.now()}`;
            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: dl.id,
                betAmount: 1000,
                game: "WINGO",
                gameCategory: "LOTTERY",
                betId: openId,
            });
            const open = await prisma.rebate.findFirstOrThrow({
                where: { betId: openId, userId: up.id },
            });
            expect(open.settled).toBe(false);
            expect(open.receiverVip).toBe(0);

            // Settled row with wrong receiverVip — must not change
            const settled = await prisma.rebate.create({
                data: {
                    userId: up.id,
                    fromUserId: dl.id,
                    amount: 1,
                    game: "WINGO",
                    gameCategory: "LOTTERY",
                    layer: 1,
                    receiverVip: 0,
                    rate: 0.5,
                    betAmount: 100,
                    betId: `settled-${Date.now()}`,
                    settled: true,
                },
            });

            await prisma.userVipLevel.update({
                where: { userId: up.id },
                data: { rebateLevel: 1 },
            });

            await VipLevelService.recomputeUnsettledRebateReceiverLevels();

            const openAfter = await prisma.rebate.findUniqueOrThrow({
                where: { id: open.id },
            });
            expect(openAfter.receiverVip).toBe(1);
            expect(openAfter.rate).toBeCloseTo(0.6, 5);
            expect(openAfter.amount).toBeCloseTo(6, 4); // 1000 * 0.6%

            const settledAfter = await prisma.rebate.findUniqueOrThrow({
                where: { id: settled.id },
            });
            expect(settledAfter.receiverVip).toBe(0);
            expect(settledAfter.amount).toBe(1);
            expect(settledAfter.settled).toBe(true);
        });
    });

    // ── 6. HTTP API ─────────────────────────────────────────────────────────

    describe("6. HTTP VIP API (XP track only for rewards)", () => {
        test("GET /user/vip/status returns currentLevel + rebateLevel", async () => {
            await prisma.user.update({
                where: { id: userId },
                data: { xp: 3500 },
            });
            await prisma.userVipLevel.update({
                where: { userId },
                data: { currentLevel: 0, rebateLevel: 2 },
            });

            const res = await get("/api/v1/user/vip/status", { cookie });
            expect(res.status).toBe(200);
            expect(res.json?.success).toBe(true);
            // sync raises XP VIP to ≥1
            expect(res.json?.data?.currentLevel).toBeGreaterThanOrEqual(1);
            // rebate sticky 2 not wiped by XP sync
            expect(res.json?.data?.rebateLevel).toBe(2);
            expect(typeof res.json?.data?.xp).toBe("number");
        });

        test("claim rejected when XP VIP below reward level even if rebate high", async () => {
            const u = await createTestUser(tracker, {
                balance: 0,
                username: uname("claim"),
            });
            const c = await authCookieFor(u);
            await prisma.user.update({
                where: { id: u.id },
                data: { xp: 0 },
            });
            await prisma.userVipLevel.upsert({
                where: { userId: u.id },
                create: {
                    userId: u.id,
                    currentLevel: 0,
                    rebateLevel: 10,
                    teamSize: 0,
                    teamBetting: 0,
                    teamDeposit: 0,
                },
                update: { currentLevel: 0, rebateLevel: 10 },
            });

            const res = await post("/api/v1/user/vip/claim-reward", {
                cookie: c,
                json: { level: 1, type: "LEVEL_UP" },
            });
            expect(res.status).toBe(400);
            expect(String(res.json?.error ?? "")).toMatch(/VIP Level 1/i);
        });

        test("claim allowed when XP VIP meets level even if rebate 0", async () => {
            const u = await createTestUser(tracker, {
                balance: 0,
                username: uname("okclaim"),
            });
            const c = await authCookieFor(u);
            await prisma.user.update({
                where: { id: u.id },
                data: { xp: 3000 },
            });
            await prisma.userVipLevel.upsert({
                where: { userId: u.id },
                create: {
                    userId: u.id,
                    currentLevel: 1,
                    rebateLevel: 0,
                    teamSize: 0,
                    teamBetting: 0,
                    teamDeposit: 0,
                },
                update: { currentLevel: 1, rebateLevel: 0 },
            });

            const res = await post("/api/v1/user/vip/claim-reward", {
                cookie: c,
                json: { level: 1, type: "LEVEL_UP" },
            });
            expect(res.status).toBe(200);
            expect(res.json?.success).toBe(true);
            expect(res.json?.amount).toBe(30);
        });

        test("place bet increments XP and can unlock XP VIP without rebateLevel", async () => {
            const u = await createTestUser(tracker, {
                balance: 50_000,
                username: uname("betxp"),
            });
            const c = await authCookieFor(u);
            await prisma.user.update({
                where: { id: u.id },
                data: { xp: 2900 },
            });
            await prisma.userVipLevel.upsert({
                where: { userId: u.id },
                create: {
                    userId: u.id,
                    currentLevel: 0,
                    rebateLevel: 0,
                    teamSize: 0,
                    teamBetting: 0,
                    teamDeposit: 0,
                },
                update: { currentLevel: 0, rebateLevel: 0 },
            });

            const period = await createActiveWingoPeriod(tracker, 300);
            const res = await post("/api/v1/wingo/bet", {
                cookie: c,
                json: {
                    periodId: period.id,
                    betType: "COLOR",
                    betChoice: "GREEN",
                    betAmount: 200,
                },
            });
            expect(res.status).toBe(201);

            // async VIP sync after bet
            await Bun.sleep(400);
            await VipLevelService.syncLevelFromXp(u.id);

            const row = await prisma.userVipLevel.findUniqueOrThrow({
                where: { userId: u.id },
            });
            const user = await prisma.user.findUniqueOrThrow({
                where: { id: u.id },
            });
            expect(user.xp).toBeGreaterThanOrEqual(3100);
            expect(row.currentLevel).toBeGreaterThanOrEqual(1);
            expect(row.rebateLevel).toBe(0);
        });
    });
});
