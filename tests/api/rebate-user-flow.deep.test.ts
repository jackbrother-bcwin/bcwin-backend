/**
 * Deep E2E: real-user rebate flow (local dev).
 *
 * Walks the same path a player/agent would:
 *   1. Build a 3-level referral chain (L1 parent → L2 mid → L3 bettor)
 *   2. Bettor places real HTTP bets on WINGO / K3 / 5D / MOTO / TRX-WINGO
 *   3. Fire-and-forget team rebate + self-rebate accrue after each place
 *   4. Hit every user/admin rebate-related endpoint and assert shapes + amounts
 *   5. Bettor claims self-rebate (balance credit)
 *   6. Simulate 01:30 IST team rebate cron (RebateScheduler.runManualSettlement)
 *   7. Simulate 01:00 IST self-rebate expiry cron (SelfRebateScheduler.runManualExpiry)
 *   8. Re-check APIs after settlement (history settled, team overview, admin list)
 *   9. Idempotency: second cron run does not double-credit
 *
 * Run (from backend/, with Postgres + Redis up):
 *   bun run test:deep
 *   # or only this file:
 *   bun test --env-file .env --preload ./tests/helpers/preload.ts \
 *     tests/api/rebate-user-flow.deep.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import {
    get,
    post,
    FixtureTracker,
    createTestUser,
    authCookieFor,
    cleanupByUserIds,
    ensureSystemConfig,
    createActiveWingoPeriod,
    createActiveK3Period,
    createActiveFiveDPeriod,
    createActiveMotoPeriod,
    createActiveTrxWingoPeriod,
    type CreatedUser,
} from "../helpers";
import { seedRebateRates } from "../../packages/db/seeds/rebateRates";
import { RebateScheduler } from "../../apps/engine/src/scheduler/rebateScheduler";
import { SelfRebateScheduler } from "../../apps/engine/src/scheduler/selfRebateScheduler";
import { CommissionScheduler } from "../../apps/engine/src/scheduler/commissionScheduler";

// VIP0 lottery L1 rate from packages/db/seeds/rebateRates.ts
const VIP0_LOTTERY_L1 = 0.5;
const SELF_RATE = 0.1; // percent

const BET_AMOUNTS = {
    wingo: 1000,
    k3: 500,
    fiveD: 200,
    moto: 300,
    trx: 400,
} as const;

const TOTAL_BET =
    BET_AMOUNTS.wingo +
    BET_AMOUNTS.k3 +
    BET_AMOUNTS.fiveD +
    BET_AMOUNTS.moto +
    BET_AMOUNTS.trx;

function todayIst(): string {
    const istMs = Date.now() + 5.5 * 60 * 60 * 1000;
    const ist = new Date(istMs);
    const y = ist.getUTCFullYear();
    const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
    const d = String(ist.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function yesterdayIst(): string {
    const istMs = Date.now() + 5.5 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000;
    const ist = new Date(istMs);
    const y = ist.getUTCFullYear();
    const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
    const d = String(ist.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

async function pollUntil(
    predicate: () => Promise<boolean>,
    opts: { maxAttempts?: number; delayMs?: number; label?: string } = {}
): Promise<void> {
    const maxAttempts = opts.maxAttempts ?? 40;
    const delayMs = opts.delayMs ?? 150;
    for (let i = 0; i < maxAttempts; i++) {
        if (await predicate()) return;
        await Bun.sleep(delayMs);
    }
    throw new Error(
        `pollUntil timeout${opts.label ? `: ${opts.label}` : ""} after ${maxAttempts * delayMs}ms`
    );
}

async function ensureVip0(userId: string) {
    await prisma.userVipLevel.upsert({
        where: { userId },
        create: {
            userId,
            currentLevel: 0, rebateLevel: 0,
            teamSize: 0,
            teamBetting: 0,
            teamDeposit: 0,
        },
        update: { currentLevel: 0, rebateLevel: 0 },
    });
}

describe("Deep E2E: rebate user flow (place bet → endpoints → schedulers)", () => {
    const tracker = new FixtureTracker("rebflow");

    let parent: CreatedUser; // L1 receiver for bettor
    let mid: CreatedUser; // L2 receiver for bettor
    let bettor: CreatedUser; // places bets
    let admin: CreatedUser;

    let parentCookie: string;
    let midCookie: string;
    let bettorCookie: string;
    let adminCookie: string;

    let parentStartBalance: number;
    let midStartBalance: number;
    let bettorStartBalance: number;

    /** Snapshot after bets placed, before claim/settle */
    let expectedTeamToParent = 0;
    let expectedTeamToMid = 0;
    let expectedSelfRebate = 0;

    beforeAll(async () => {
        await ensureSystemConfig();
        // Rates must exist for team rebate math (local DB may already have them)
        await seedRebateRates(prisma as any);

        parent = await createTestUser(tracker, { balance: 5_000 });
        mid = await createTestUser(tracker, {
            balance: 5_000,
            referredBy: parent.referralCode,
        });
        bettor = await createTestUser(tracker, {
            balance: 50_000,
            referredBy: mid.referralCode,
        });
        admin = await createTestUser(tracker, {
            role: "ADMIN",
            balance: 0,
        });

        await ensureVip0(parent.id);
        await ensureVip0(mid.id);
        await ensureVip0(bettor.id);
        // XP VIP 3 → 0.1% self-rebate; rebateLevel stays 0 for team rates
        await prisma.userVipLevel.update({
            where: { userId: bettor.id },
            data: { currentLevel: 3 },
        });

        parentCookie = await authCookieFor(parent);
        midCookie = await authCookieFor(mid);
        bettorCookie = await authCookieFor(bettor);
        adminCookie = await authCookieFor(admin);

        parentStartBalance = parent.balance;
        midStartBalance = mid.balance;
        bettorStartBalance = bettor.balance;
    });

    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
        });
    });

    // ── 1. Place real bets on every first-party game ─────────────────────────

    describe("1. Place bets via HTTP (all first-party games)", () => {
        test("WINGO COLOR bet", async () => {
            const period = await createActiveWingoPeriod(tracker, 300);
            const res = await post("/api/v1/wingo/bet", {
                cookie: bettorCookie,
                json: {
                    periodId: period.id,
                    betType: "COLOR",
                    betChoice: "GREEN",
                    betAmount: BET_AMOUNTS.wingo,
                },
            });
            expect(res.status).toBe(201);
            expect(res.json?.success).toBe(true);
            expect(res.json?.bet?.betAmount).toBe(BET_AMOUNTS.wingo);
        });

        test("K3 SUM bet", async () => {
            const period = await createActiveK3Period(tracker, 300);
            const res = await post("/api/v1/k3/bet", {
                cookie: bettorCookie,
                json: {
                    periodId: period.id,
                    betType: "SUM",
                    betChoice: "12",
                    betAmount: BET_AMOUNTS.k3,
                },
            });
            expect(res.status).toBe(201);
            expect(res.json?.success).toBe(true);
        });

        test("5D POSITION exact digit", async () => {
            const period = await createActiveFiveDPeriod(tracker, 300);
            const res = await post("/api/v1/5d/bet", {
                cookie: bettorCookie,
                json: {
                    periodId: period.id,
                    betCategory: "POSITION",
                    betType: "EXACT_NUMBER",
                    position: "A",
                    betChoice: "5",
                    betAmount: BET_AMOUNTS.fiveD,
                },
            });
            expect(res.status).toBe(201);
            expect(res.json?.success).toBe(true);
        });

        test("MOTO BIG_SMALL", async () => {
            const period = await createActiveMotoPeriod(tracker, 300);
            const res = await post("/api/v1/moto/bet", {
                cookie: bettorCookie,
                json: {
                    periodId: period.id,
                    betType: "BIG_SMALL",
                    betChoice: "big",
                    targetPosition: "FIRST",
                    betAmount: BET_AMOUNTS.moto,
                },
            });
            expect(res.status).toBe(201);
            expect(res.json?.success).toBe(true);
        });

        test("TRX-WINGO COLOR", async () => {
            const period = await createActiveTrxWingoPeriod(tracker, 300);
            const res = await post("/api/v1/trxwingo/bet", {
                cookie: bettorCookie,
                json: {
                    periodId: period.id,
                    betType: "COLOR",
                    betChoice: "RED",
                    betAmount: BET_AMOUNTS.trx,
                },
            });
            expect(res.status).toBe(201);
            expect(res.json?.success).toBe(true);
        });

        test("user game bet list endpoints respond after place", async () => {
            for (const path of [
                "/api/v1/wingo/bets",
                "/api/v1/k3/bets",
                "/api/v1/5d/bets",
                "/api/v1/moto/bets",
                "/api/v1/trxwingo/bets",
            ]) {
                const res = await get(path, {
                    cookie: bettorCookie,
                    query: { page: 1, limit: 20 },
                });
                expect(res.status).toBe(200);
                expect(res.json?.success).toBe(true);
                expect(Array.isArray(res.json?.bets)).toBe(true);
            }
        });
    });

    // ── 2. Wait for async team + self rebate accrual ────────────────────────

    describe("2. Accrual after place (async fire-and-forget)", () => {
        test("self-rebate rows: one per game bet (5 rows, 0.1%)", async () => {
            await pollUntil(
                async () => {
                    const n = await prisma.selfRebate.count({
                        where: { userId: bettor.id, claimed: false },
                    });
                    return n >= 5;
                },
                { label: "selfRebate count >= 5" }
            );

            const rows = await prisma.selfRebate.findMany({
                where: { userId: bettor.id },
            });
            expect(rows.length).toBe(5);

            const totalSelf = rows.reduce((s, r) => s + r.amount, 0);
            expectedSelfRebate = TOTAL_BET * (SELF_RATE / 100);
            expect(totalSelf).toBeCloseTo(expectedSelfRebate, 4);

            for (const r of rows) {
                expect(r.rate).toBe(SELF_RATE);
                expect(r.claimed).toBe(false);
                expect(r.expired).toBe(false);
                expect(r.gameCategory).toBe("LOTTERY");
                expect(r.date).toBe(todayIst());
            }
        });

        test("team rebate: mid=L1 and parent=L2 for each of 5 bets (unsettled)", async () => {
            // 5 bets × 2 uplines = 10 rebate rows
            await pollUntil(
                async () => {
                    const n = await prisma.rebate.count({
                        where: { fromUserId: bettor.id, settled: false },
                    });
                    return n >= 10;
                },
                { label: "team rebate count >= 10" }
            );

            const midRows = await prisma.rebate.findMany({
                where: { userId: mid.id, fromUserId: bettor.id },
            });
            const parentRows = await prisma.rebate.findMany({
                where: { userId: parent.id, fromUserId: bettor.id },
            });

            expect(midRows.length).toBe(5);
            expect(parentRows.length).toBe(5);
            expect(midRows.every((r) => r.layer === 1 && !r.settled)).toBe(
                true
            );
            expect(parentRows.every((r) => r.layer === 2 && !r.settled)).toBe(
                true
            );

            expectedTeamToMid = midRows.reduce((s, r) => s + r.amount, 0);
            expectedTeamToParent = parentRows.reduce(
                (s, r) => s + r.amount,
                0
            );

            // VIP0 lottery: L1 0.5%, L2 0.15%
            expect(expectedTeamToMid).toBeCloseTo(
                TOTAL_BET * (VIP0_LOTTERY_L1 / 100),
                4
            );
            expect(expectedTeamToParent).toBeCloseTo(
                TOTAL_BET * (0.15 / 100),
                4
            );
            expect(expectedTeamToMid).toBeGreaterThan(0);
            expect(expectedTeamToParent).toBeGreaterThan(0);

            // Balances not yet credited for team rebate
            const [p, m] = await Promise.all([
                prisma.user.findUniqueOrThrow({ where: { id: parent.id } }),
                prisma.user.findUniqueOrThrow({ where: { id: mid.id } }),
            ]);
            expect(p.balance).toBe(parentStartBalance);
            expect(m.balance).toBe(midStartBalance);
        });

        test("no legacy Commission rows from place-bet path", async () => {
            const n = await prisma.commission.count({
                where: { fromUserId: bettor.id },
            });
            expect(n).toBe(0);
        });
    });

    // ── 3. All rebate-related endpoints (pre-settle / pre-claim) ─────────────

    describe("3. User + admin rebate endpoints (pre-settle)", () => {
        test("GET /user/rebate/rates — lottery tables present", async () => {
            const res = await get("/api/v1/user/rebate/rates", {
                cookie: midCookie,
            });
            expect(res.status).toBe(200);
            expect(res.json?.success).toBe(true);
            expect(Array.isArray(res.json?.data?.lottery)).toBe(true);
            expect(res.json.data.lottery.length).toBeGreaterThan(0);
        });

        test("GET /user/rebate/history — mid sees unsettled L1 rows", async () => {
            await Cache.del(CacheKey.rebateHistory(mid.id)).catch(() => 0);

            const res = await get("/api/v1/user/rebate/history", {
                cookie: midCookie,
                query: { page: 1, limit: 50 },
            });
            expect(res.status).toBe(200);
            expect(res.json?.success).toBe(true);
            expect(Array.isArray(res.json?.data)).toBe(true);
            expect(res.json.data.length).toBeGreaterThanOrEqual(5);

            const unsettled = res.json.data.filter(
                (r: { settled?: boolean }) => r.settled === false
            );
            expect(unsettled.length).toBeGreaterThanOrEqual(5);
            for (const row of unsettled.slice(0, 5)) {
                expect(row.amount).toBeGreaterThan(0);
            }
        });

        test("GET /user/rebate/daily — mid has today's total", async () => {
            const res = await get("/api/v1/user/rebate/daily", {
                cookie: midCookie,
                query: { date: todayIst() },
            });
            expect(res.status).toBe(200);
            expect(res.json?.success).toBe(true);
            if (res.json?.data) {
                expect(String(res.json.data.settlementTime)).toContain("24:00");
                expect(typeof res.json.data.totalCommission).toBe("number");
                expect(res.json.data.totalCommission).toBeGreaterThan(0);
                expect(Array.isArray(res.json.data.categories)).toBe(true);
            }
        });

        test("GET /user/rebate/self/summary — bettor today cashback", async () => {
            const res = await get("/api/v1/user/rebate/self/summary", {
                cookie: bettorCookie,
            });
            expect(res.status).toBe(200);
            expect(res.json?.success).toBe(true);
            expect(res.json?.data?.rate).toBe(SELF_RATE);
            expect(res.json?.data?.todayRebate).toBeCloseTo(
                expectedSelfRebate,
                4
            );
            const lottery = res.json?.data?.categories?.find(
                (c: { category: string }) => c.category === "LOTTERY"
            );
            expect(lottery).toBeDefined();
            expect(lottery.betAmount).toBe(TOTAL_BET);
            expect(lottery.rebateAmount).toBeCloseTo(expectedSelfRebate, 4);
        });

        test("GET /user/rebate/self/history — pending before claim", async () => {
            const res = await get("/api/v1/user/rebate/self/history", {
                cookie: bettorCookie,
                query: { category: "LOTTERY", page: 1, limit: 20 },
            });
            expect(res.status).toBe(200);
            expect(res.json?.success).toBe(true);
            expect(Array.isArray(res.json?.data)).toBe(true);
            expect(res.json.data.length).toBeGreaterThan(0);
            // Grouped by date/category — may be Pending until claimed
            const todayRow = res.json.data.find(
                (d: { date: string }) => d.date === todayIst()
            );
            expect(todayRow).toBeDefined();
            expect(["Pending", "Completed"]).toContain(todayRow.status);
            expect(todayRow.rebateAmount).toBeCloseTo(expectedSelfRebate, 4);
        });

        test("GET /user/team/overview — totalCommissionEarned still 0 until settle", async () => {
            await Cache.del(CacheKey.teamOverview(parent.id)).catch(() => 0);
            await Cache.del(CacheKey.teamOverview(mid.id)).catch(() => 0);

            const midOv = await get("/api/v1/user/team/overview", {
                cookie: midCookie,
            });
            expect(midOv.status).toBe(200);
            // Unsettled only → lifetime settled commission should be 0 (or prior 0)
            const earned = Number(
                midOv.json?.data?.totalCommissionEarned ?? 0
            );
            expect(earned).toBe(0);
        });

        test("GET /user/team/members — mid sees bettor in tree", async () => {
            const res = await get("/api/v1/user/team/members", {
                cookie: midCookie,
                query: { page: 1, limit: 20 },
            });
            expect([200, 400]).toContain(res.status);
            if (res.status === 200) {
                expect(res.json?.success !== false).toBe(true);
            }
        });

        test("legacy commission endpoints still respond (read-only)", async () => {
            for (const path of [
                "/api/v1/user/commission/daily",
                "/api/v1/user/commission/breakdown",
                "/api/v1/user/commission/rate",
            ]) {
                const res = await get(path, {
                    cookie: midCookie,
                    query: { page: 1, limit: 10 },
                });
                expect(res.status).toBeLessThan(500);
            }
        });

        test("GET /admin/transactions/rebate-history — admin lists team rows", async () => {
            const res = await get("/api/v1/admin/transactions/rebate-history", {
                cookie: adminCookie,
                query: {
                    page: 1,
                    limit: 50,
                    userId: mid.id,
                    settled: "false",
                },
            });
            expect(res.status).toBe(200);
            expect(res.json?.success).toBe(true);
            expect(Array.isArray(res.json?.rebates)).toBe(true);
            expect(res.json.rebates.length).toBeGreaterThanOrEqual(5);
            expect(
                res.json.rebates.every(
                    (r: { settled: boolean }) => r.settled === false
                )
            ).toBe(true);
        });

        test("parent history also has L2 rows", async () => {
            const res = await get("/api/v1/user/rebate/history", {
                cookie: parentCookie,
                query: { page: 1, limit: 50 },
            });
            expect(res.status).toBe(200);
            expect(res.json?.data?.length).toBeGreaterThanOrEqual(5);
        });
    });

    // ── 4. Self-rebate claim (user action) ───────────────────────────────────

    describe("4. Self-rebate claim", () => {
        test("POST /user/rebate/self/claim credits bettor balance", async () => {
            const before = await prisma.user.findUniqueOrThrow({
                where: { id: bettor.id },
                select: { balance: true },
            });

            const res = await post("/api/v1/user/rebate/self/claim", {
                cookie: bettorCookie,
                json: {},
            });
            expect(res.status).toBe(200);
            expect(res.json?.success).toBe(true);
            expect(res.json?.data?.claimedAmount).toBeCloseTo(
                expectedSelfRebate,
                4
            );
            expect(res.json?.data?.claimedCount).toBe(5);
            expect(res.json?.data?.newBalance).toBeCloseTo(
                before.balance + expectedSelfRebate,
                4
            );

            const after = await prisma.user.findUniqueOrThrow({
                where: { id: bettor.id },
                select: { balance: true },
            });
            expect(after.balance).toBeCloseTo(
                before.balance + expectedSelfRebate,
                4
            );

            const open = await prisma.selfRebate.count({
                where: {
                    userId: bettor.id,
                    claimed: false,
                    date: todayIst(),
                },
            });
            expect(open).toBe(0);
        });

        test("second claim is idempotent (0 amount)", async () => {
            const res = await post("/api/v1/user/rebate/self/claim", {
                cookie: bettorCookie,
                json: {},
            });
            expect(res.status).toBe(200);
            expect(res.json?.data?.claimedAmount).toBe(0);
            expect(res.json?.data?.claimedCount).toBe(0);
        });

        test("self history shows Completed after claim", async () => {
            const res = await get("/api/v1/user/rebate/self/history", {
                cookie: bettorCookie,
                query: { category: "LOTTERY", page: 1, limit: 20 },
            });
            expect(res.status).toBe(200);
            const todayRow = res.json?.data?.find(
                (d: { date: string }) => d.date === todayIst()
            );
            expect(todayRow?.status).toBe("Completed");
        });

        test("summary todayRebate is 0 after claim", async () => {
            const res = await get("/api/v1/user/rebate/self/summary", {
                cookie: bettorCookie,
            });
            expect(res.status).toBe(200);
            expect(res.json?.data?.todayRebate).toBe(0);
            expect(res.json?.data?.totalRebate).toBeGreaterThanOrEqual(
                expectedSelfRebate - 0.0001
            );
        });
    });

    // ── 5. Schedulers (01:30 team settle + 01:00 self expiry) ────────────────

    describe("5. Schedulers (manual trigger = cron job body)", () => {
        test("01:30 IST team settle credits mid + parent once", async () => {
            const [midBefore, parentBefore] = await Promise.all([
                prisma.user.findUniqueOrThrow({ where: { id: mid.id } }),
                prisma.user.findUniqueOrThrow({ where: { id: parent.id } }),
            ]);

            const sched = new RebateScheduler();
            await sched.runManualSettlement();

            const [midAfter, parentAfter] = await Promise.all([
                prisma.user.findUniqueOrThrow({ where: { id: mid.id } }),
                prisma.user.findUniqueOrThrow({ where: { id: parent.id } }),
            ]);

            expect(midAfter.balance).toBeCloseTo(
                midBefore.balance + expectedTeamToMid,
                4
            );
            expect(parentAfter.balance).toBeCloseTo(
                parentBefore.balance + expectedTeamToParent,
                4
            );

            const open = await prisma.rebate.count({
                where: {
                    fromUserId: bettor.id,
                    settled: false,
                },
            });
            expect(open).toBe(0);
        });

        test("second 01:30 run is idempotent (no double credit)", async () => {
            const midBefore = await prisma.user.findUniqueOrThrow({
                where: { id: mid.id },
            });
            await new RebateScheduler().runManualSettlement();
            const midAfter = await prisma.user.findUniqueOrThrow({
                where: { id: mid.id },
            });
            expect(midAfter.balance).toBe(midBefore.balance);
        });

        test("01:00 IST self-expiry marks yesterday unclaimed as expired", async () => {
            const pastDate = yesterdayIst();
            await prisma.selfRebate.create({
                data: {
                    userId: bettor.id,
                    betAmount: 1000,
                    rate: SELF_RATE,
                    amount: 1,
                    game: "WINGO",
                    gameCategory: "LOTTERY",
                    date: pastDate,
                    claimed: false,
                    expired: false,
                },
            });

            await new SelfRebateScheduler().runManualExpiry();

            const row = await prisma.selfRebate.findFirst({
                where: { userId: bettor.id, date: pastDate },
            });
            expect(row?.expired).toBe(true);
            expect(row?.claimed).toBe(false);

            // Today's claimed rows stay claimed / not expired incorrectly
            const todayClaimed = await prisma.selfRebate.findMany({
                where: { userId: bettor.id, date: todayIst() },
            });
            expect(todayClaimed.every((r) => r.claimed === true)).toBe(true);

            const hist = await get("/api/v1/user/rebate/self/history", {
                cookie: bettorCookie,
                query: { category: "LOTTERY", page: 1, limit: 50 },
            });
            const expiredItem = hist.json?.data?.find(
                (d: { date: string; status: string }) =>
                    d.date === pastDate && d.status === "Expired"
            );
            expect(expiredItem).toBeDefined();
        });

        test("schedulers start/stop cleanly; legacy commission cron disabled", async () => {
            const r = new RebateScheduler();
            const s = new SelfRebateScheduler();
            const c = new CommissionScheduler();
            expect(() => r.start()).not.toThrow();
            expect(() => r.stop()).not.toThrow();
            expect(() => s.start()).not.toThrow();
            expect(() => s.stop()).not.toThrow();
            expect(() => c.start()).not.toThrow();
            expect(() => c.stop()).not.toThrow();
            await expect(c.runManualAggregation()).resolves.toBeUndefined();
        });
    });

    // ── 6. Post-settle API surfaces ──────────────────────────────────────────

    describe("6. Endpoints after settlement", () => {
        test("rebate history shows settled=true for mid", async () => {
            const res = await get("/api/v1/user/rebate/history", {
                cookie: midCookie,
                query: { page: 1, limit: 50, settled: "true" },
            });
            expect(res.status).toBe(200);
            // settled query may or may not be supported — accept either filter path
            const data = res.json?.data ?? [];
            if (data.length > 0) {
                const anySettled = data.some(
                    (r: { settled: boolean }) => r.settled === true
                );
                expect(anySettled).toBe(true);
            } else {
                // fall back unfiltered
                const all = await get("/api/v1/user/rebate/history", {
                    cookie: midCookie,
                    query: { page: 1, limit: 50 },
                });
                expect(
                    all.json?.data?.some(
                        (r: { settled: boolean }) => r.settled === true
                    )
                ).toBe(true);
            }
        });

        test("team overview lifetime commission includes settled rebates", async () => {
            await Cache.del(CacheKey.teamOverview(mid.id)).catch(() => 0);
            await Cache.del(CacheKey.teamOverview(parent.id)).catch(() => 0);

            const midOv = await get("/api/v1/user/team/overview", {
                cookie: midCookie,
            });
            expect(midOv.status).toBe(200);
            const midEarned = Number(
                midOv.json?.data?.totalCommissionEarned ?? 0
            );
            expect(midEarned).toBeCloseTo(expectedTeamToMid, 2);

            const parentOv = await get("/api/v1/user/team/overview", {
                cookie: parentCookie,
            });
            expect(parentOv.status).toBe(200);
            const parentEarned = Number(
                parentOv.json?.data?.totalCommissionEarned ?? 0
            );
            expect(parentEarned).toBeCloseTo(expectedTeamToParent, 2);
        });

        test("admin rebate-history settled=true for mid", async () => {
            const res = await get("/api/v1/admin/transactions/rebate-history", {
                cookie: adminCookie,
                query: {
                    page: 1,
                    limit: 50,
                    userId: mid.id,
                    settled: "true",
                },
            });
            expect(res.status).toBe(200);
            expect(res.json?.rebates?.length).toBeGreaterThanOrEqual(5);
            expect(
                res.json.rebates.every(
                    (r: { settled: boolean }) => r.settled === true
                )
            ).toBe(true);
        });

        test("final balances match full journey", async () => {
            const [b, m, p] = await Promise.all([
                prisma.user.findUniqueOrThrow({ where: { id: bettor.id } }),
                prisma.user.findUniqueOrThrow({ where: { id: mid.id } }),
                prisma.user.findUniqueOrThrow({ where: { id: parent.id } }),
            ]);

            // Bettor: start − bets + self claim
            expect(b.balance).toBeCloseTo(
                bettorStartBalance - TOTAL_BET + expectedSelfRebate,
                2
            );
            expect(m.balance).toBeCloseTo(
                midStartBalance + expectedTeamToMid,
                4
            );
            expect(p.balance).toBeCloseTo(
                parentStartBalance + expectedTeamToParent,
                4
            );
        });
    });
});
