/**
 * Deep tests — admin summaries are real USERs + SUCCESS money (ADR-0024).
 *
 * Locks:
 *  1. Overview users / balance skip ADMIN, SUB_ADMIN, AGENT, demo.
 *  2. Today’s recharge / withdraw = SUCCESS only (created today).
 *  3. ADMIN_MANUAL SUCCESS on a real USER counts; staff / demo SUCCESS does not.
 *  4. PROCESSING / FAILED / GENERATED / USER_CANCELED stay off headlines.
 *  5. Yesterday SUCCESS is in all-time success, not today.
 *  6. Balance-adjust is not a deposit.
 *  7. Bets / wins include Inout and exclude staff / demo.
 *  8. P&L today matches that bet universe.
 *  9. Turnover row for a real USER uses SUCCESS deposits only.
 * 10. Top performance never lists staff / demo.
 * 11. User-hub team recharge walks only real USER downlines.
 * 12. Deposit / withdraw finance queues filter out demo accounts by default, but allow them when querying by userId.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import {
    REAL_SUCCESS_DEPOSIT_WHERE,
    REAL_SUCCESS_WITHDRAW_WHERE,
    REAL_USER_WHERE,
} from "../../apps/api/src/lib/realUserFilter";
import {
    get,
    patch,
    FixtureTracker,
    createTestUser,
    authCookieFor,
    cleanupByUserIds,
    ensureSystemConfig,
    createActiveWingoPeriod,
} from "../helpers";

const UPI_OK = 2501;
const MANUAL_OK = 2502;
const PENDING_DEP = 8100;
const FAILED_DEP = 8200;
const YDAY_OK = 8300;
const ADMIN_OK = 9101;
const AGENT_OK = 9102;
const SUB_OK = 9103;
const DEMO_OK = 9104;

const WD_OK = 3101;
const WD_PROC = 3200;
const WD_GEN = 3300;
const WD_FAIL = 3400;
const WD_CANCEL = 3600;
const WD_AGENT = 3500;
const WD_DEMO = 3700;

const WINGO_BET = 41;
const WINGO_WIN = 80;
const INOUT_BET = 42;
const INOUT_WIN = 15;
const AGENT_BET = 777;
const DEMO_INOUT = 888;

const CHILD_USER_DEP = 111;
const CHILD_AGENT_DEP = 222;
const CHILD_DEMO_DEP = 333;

const ADJUST = 77;
const STAFF_BAL_BUMP = 50_000;

function n(v: unknown): number {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
}

async function markDemo(id: string) {
    await prisma.user.update({ where: { id }, data: { isDemo: true } });
}

async function purgeSummaryCache(userIds: string[]) {
    await Cache.del(CacheKey.adminOverview);
    await Cache.del(CacheKey.adminProfitLoss);
    await Cache.del(CacheKey.adminTopPerformance);
    await Cache.del(CacheKey.adminDeposits);
    await Cache.del(CacheKey.adminWithdrawals);
    await Cache.del(CacheKey.adminUsers);
    await Promise.all(userIds.map((id) => Cache.del(CacheKey.adminUserStats(id))));
}

describe("Admin real-success summaries (ADR-0024)", () => {
    const tracker = new FixtureTracker("ars");
    const oid = (tag: string) => `${tracker.orderPrefix}${tag}`;

    let admin: Awaited<ReturnType<typeof createTestUser>>;
    let sub: Awaited<ReturnType<typeof createTestUser>>;
    let agent: Awaited<ReturnType<typeof createTestUser>>;
    let demo: Awaited<ReturnType<typeof createTestUser>>;
    let real: Awaited<ReturnType<typeof createTestUser>>;
    let parent: Awaited<ReturnType<typeof createTestUser>>;
    let childUser: Awaited<ReturnType<typeof createTestUser>>;
    let childAgent: Awaited<ReturnType<typeof createTestUser>>;
    let childDemo: Awaited<ReturnType<typeof createTestUser>>;
    let adminCookie: string;
    let userCookie: string;

    let snap: {
        todayCount: number;
        totalCount: number;
        totalBalance: number;
        activeCount: number;
        todayDep: number;
        successDep: number;
        pendingDep: number;
        failedDep: number;
        todayWd: number;
        successWd: number;
        pendingWd: number;
        failedWd: number;
        todayBet: number;
        todayWin: number;
        todayProfit: number;
        totalBet: number;
        totalWin: number;
        plInvested: number;
        plWon: number;
        plNet: number;
    };

    beforeAll(async () => {
        await ensureSystemConfig();

        admin = await createTestUser(tracker, { role: "ADMIN", balance: 1_000 });
        sub = await createTestUser(tracker, { role: "SUB_ADMIN", balance: 2_000 });
        agent = await createTestUser(tracker, { role: "AGENT", balance: 3_000 });
        demo = await createTestUser(tracker, { balance: 4_000 });
        await markDemo(demo.id);
        real = await createTestUser(tracker, { balance: 5_000 });
        parent = await createTestUser(tracker, { balance: 6_000 });
        childUser = await createTestUser(tracker, {
            balance: 100,
            referredBy: parent.referralCode,
        });
        childAgent = await createTestUser(tracker, {
            role: "AGENT",
            balance: 100,
            referredBy: parent.referralCode,
        });
        childDemo = await createTestUser(tracker, {
            balance: 100,
            referredBy: parent.referralCode,
        });
        await markDemo(childDemo.id);

        adminCookie = await authCookieFor(admin);
        userCookie = await authCookieFor(real);

        await purgeSummaryCache(tracker.userIds);

        const ov = await get("/api/v1/admin/overview", { cookie: adminCookie });
        expect(ov.status).toBe(200);
        const pl = await get("/api/v1/admin/profit-loss", {
            cookie: adminCookie,
            query: { dateFilter: "today" },
        });
        expect(pl.status).toBe(200);

        const u = ov.json?.data?.users ?? {};
        const d = ov.json?.data?.deposits ?? {};
        const w = ov.json?.data?.withdrawals ?? {};
        const b = ov.json?.data?.bets ?? {};
        const cards = pl.json?.data?.cardItems ?? {};
        const dist = pl.json?.data?.winLossDistribution ?? {};

        snap = {
            todayCount: n(u.todayCount),
            totalCount: n(u.totalCount),
            totalBalance: n(u.totalBalance),
            activeCount: n(u.activeCount),
            todayDep: n(d.todayAmount),
            successDep: n(d.successAmount),
            pendingDep: n(d.pendingAmount),
            failedDep: n(d.failedAmount),
            todayWd: n(w.todayAmount),
            successWd: n(w.successAmount),
            pendingWd: n(w.pendingAmount),
            failedWd: n(w.failedAmount),
            todayBet: n(b.todayTotalBet),
            todayWin: n(b.todayTotalWin),
            todayProfit: n(b.todayProfit),
            totalBet: n(b.totalBet),
            totalWin: n(b.totalWin),
            plInvested: n(cards.totalInvested),
            plWon: n(dist.totalWin),
            plNet: n(cards.netPL),
        };

        const yday = new Date();
        yday.setDate(yday.getDate() - 1);
        yday.setHours(12, 0, 0, 0);

        await prisma.deposit.createMany({
            data: [
                {
                    orderId: oid("upi"),
                    amount: UPI_OK,
                    method: "UPI",
                    status: "SUCCESS",
                    userId: real.id,
                },
                {
                    orderId: oid("man"),
                    amount: MANUAL_OK,
                    method: "ADMIN_MANUAL",
                    status: "SUCCESS",
                    userId: real.id,
                },
                {
                    orderId: oid("pend"),
                    amount: PENDING_DEP,
                    method: "UPI",
                    status: "PROCESSING",
                    userId: real.id,
                },
                {
                    orderId: oid("fail"),
                    amount: FAILED_DEP,
                    method: "UPI",
                    status: "FAILED",
                    userId: real.id,
                },
                {
                    orderId: oid("yday"),
                    amount: YDAY_OK,
                    method: "UPI",
                    status: "SUCCESS",
                    userId: real.id,
                    createdAt: yday,
                },
                {
                    orderId: oid("adm"),
                    amount: ADMIN_OK,
                    method: "ADMIN_MANUAL",
                    status: "SUCCESS",
                    userId: admin.id,
                },
                {
                    orderId: oid("agt"),
                    amount: AGENT_OK,
                    method: "UPI",
                    status: "SUCCESS",
                    userId: agent.id,
                },
                {
                    orderId: oid("sub"),
                    amount: SUB_OK,
                    method: "UPI",
                    status: "SUCCESS",
                    userId: sub.id,
                },
                {
                    orderId: oid("demo"),
                    amount: DEMO_OK,
                    method: "UPI",
                    status: "SUCCESS",
                    userId: demo.id,
                },
                {
                    orderId: oid("cuser"),
                    amount: CHILD_USER_DEP,
                    method: "UPI",
                    status: "SUCCESS",
                    userId: childUser.id,
                },
                {
                    orderId: oid("cagt"),
                    amount: CHILD_AGENT_DEP,
                    method: "UPI",
                    status: "SUCCESS",
                    userId: childAgent.id,
                },
                {
                    orderId: oid("cdemo"),
                    amount: CHILD_DEMO_DEP,
                    method: "UPI",
                    status: "SUCCESS",
                    userId: childDemo.id,
                },
            ],
        });

        await prisma.withdraw.createMany({
            data: [
                {
                    orderId: oid("wdok"),
                    amount: WD_OK,
                    method: "CXPAY",
                    status: "SUCCESS",
                    userId: real.id,
                },
                {
                    orderId: oid("wdpr"),
                    amount: WD_PROC,
                    method: "CXPAY",
                    status: "PROCESSING",
                    userId: real.id,
                },
                {
                    orderId: oid("wdgn"),
                    amount: WD_GEN,
                    method: "CXPAY",
                    status: "GENERATED",
                    userId: real.id,
                },
                {
                    orderId: oid("wdf"),
                    amount: WD_FAIL,
                    method: "CXPAY",
                    status: "FAILED",
                    userId: real.id,
                },
                {
                    orderId: oid("wdc"),
                    amount: WD_CANCEL,
                    method: "CXPAY",
                    status: "USER_CANCELED",
                    userId: real.id,
                },
                {
                    orderId: oid("wdag"),
                    amount: WD_AGENT,
                    method: "CXPAY",
                    status: "SUCCESS",
                    userId: agent.id,
                },
                {
                    orderId: oid("wddm"),
                    amount: WD_DEMO,
                    method: "CXPAY",
                    status: "SUCCESS",
                    userId: demo.id,
                },
            ],
        });

        const period = await createActiveWingoPeriod(tracker, 60);
        const realWingo = await prisma.wingoBet.create({
            data: {
                userId: real.id,
                periodId: period.id,
                betAmount: WINGO_BET,
                contractAmount: WINGO_BET * 0.98,
                betType: "COLOR",
                betChoice: "RED",
            },
        });
        await prisma.wingoBetResult.create({
            data: {
                betId: realWingo.id,
                periodId: period.id,
                isWin: true,
                winAmount: WINGO_WIN,
            },
        });
        await prisma.wingoBet.create({
            data: {
                userId: agent.id,
                periodId: period.id,
                betAmount: AGENT_BET,
                contractAmount: AGENT_BET * 0.98,
                betType: "COLOR",
                betChoice: "GREEN",
            },
        });

        await prisma.inoutBet.createMany({
            data: [
                {
                    userId: real.id,
                    token: `${tracker.runId}_tok_r`,
                    gameMode: "slots",
                    betAmount: INOUT_BET,
                    currency: "INR",
                    operator: "test",
                    transactionId: `${tracker.runId}_tx_r`,
                    gameId: "g1",
                    winAmount: INOUT_WIN,
                },
                {
                    userId: demo.id,
                    token: `${tracker.runId}_tok_d`,
                    gameMode: "slots",
                    betAmount: DEMO_INOUT,
                    currency: "INR",
                    operator: "test",
                    transactionId: `${tracker.runId}_tx_d`,
                    gameId: "g1",
                    winAmount: 1,
                },
            ],
        });

        await prisma.user.update({
            where: { id: admin.id },
            data: { balance: { increment: STAFF_BAL_BUMP } },
        });

        await purgeSummaryCache(tracker.userIds);
    });

    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
            giftCodePrefix: tracker.giftPrefix,
            orderIdPrefix: tracker.orderPrefix,
        });
        await purgeSummaryCache(tracker.userIds);
    });

    test("filter constants exclude staff and require SUCCESS", () => {
        expect(REAL_USER_WHERE).toEqual({ isDemo: false, role: "USER" });
        expect(REAL_SUCCESS_DEPOSIT_WHERE.status).toBe("SUCCESS");
        expect(REAL_SUCCESS_WITHDRAW_WHERE.status).toBe("SUCCESS");
        expect(REAL_SUCCESS_DEPOSIT_WHERE.user).toEqual(REAL_USER_WHERE);
    });

    test("player cookie cannot read admin overview", async () => {
        const res = await get("/api/v1/admin/overview", { cookie: userCookie });
        expect(res.status).toBe(401);
    });

    test("overview users skip staff / demo; staff balance bump is ignored", async () => {
        const res = await get("/api/v1/admin/overview", { cookie: adminCookie });
        expect(res.status).toBe(200);
        const users = res.json?.data?.users ?? {};
        // parent + real + childUser were created today (demo/staff/agent excluded)
        expect(n(users.totalCount)).toBeGreaterThanOrEqual(snap.totalCount);
        expect(n(users.todayCount)).toBeGreaterThanOrEqual(snap.todayCount);
        expect(n(users.totalBalance)).toBe(snap.totalBalance);
        expect(n(users.totalBalance)).not.toBe(
            snap.totalBalance + STAFF_BAL_BUMP
        );
    });

    test("today recharge is SUCCESS real USER only (UPI + ADMIN_MANUAL)", async () => {
        const res = await get("/api/v1/admin/overview", { cookie: adminCookie });
        const d = res.json?.data?.deposits ?? {};
        expect(n(d.todayAmount)).toBe(
            snap.todayDep + UPI_OK + MANUAL_OK + CHILD_USER_DEP
        );
        expect(n(d.successAmount)).toBe(
            snap.successDep + UPI_OK + MANUAL_OK + YDAY_OK + CHILD_USER_DEP
        );
        expect(n(d.pendingAmount)).toBe(snap.pendingDep + PENDING_DEP);
        expect(n(d.failedAmount)).toBe(snap.failedDep + FAILED_DEP);
        const noise =
            PENDING_DEP +
            FAILED_DEP +
            ADMIN_OK +
            AGENT_OK +
            SUB_OK +
            DEMO_OK +
            CHILD_AGENT_DEP +
            CHILD_DEMO_DEP;
        expect(n(d.todayAmount)).not.toBe(snap.todayDep + UPI_OK + MANUAL_OK + noise);
    });

    test("today withdraw is SUCCESS real USER only", async () => {
        const res = await get("/api/v1/admin/overview", { cookie: adminCookie });
        const w = res.json?.data?.withdrawals ?? {};
        expect(n(w.todayAmount)).toBe(snap.todayWd + WD_OK);
        expect(n(w.successAmount)).toBe(snap.successWd + WD_OK);
        expect(n(w.pendingAmount)).toBe(snap.pendingWd + WD_PROC + WD_GEN);
        expect(n(w.failedAmount)).toBe(snap.failedWd + WD_FAIL);
        expect(n(w.todayAmount)).not.toBe(snap.todayWd + WD_OK + WD_AGENT);
        expect(n(w.pendingAmount)).not.toBe(
            snap.pendingWd + WD_PROC + WD_GEN + WD_CANCEL
        );
    });

    test("overview bets include Inout and skip staff / demo", async () => {
        const res = await get("/api/v1/admin/overview", { cookie: adminCookie });
        const b = res.json?.data?.bets ?? {};
        const addedBet = WINGO_BET + INOUT_BET;
        const addedWin = WINGO_WIN + INOUT_WIN;
        expect(n(b.todayTotalBet)).toBe(snap.todayBet + addedBet);
        expect(n(b.totalBet)).toBe(snap.totalBet + addedBet);
        expect(n(b.todayTotalWin)).toBe(snap.todayWin + addedWin);
        expect(n(b.totalWin)).toBe(snap.totalWin + addedWin);
        expect(n(b.todayProfit)).toBe(snap.todayProfit + addedBet - addedWin);
        expect(n(res.json?.data?.users?.activeCount)).toBe(snap.activeCount + 1);
        expect(n(b.todayTotalBet)).not.toBe(
            snap.todayBet + addedBet + AGENT_BET + DEMO_INOUT
        );
    });

    test("P&L today uses the same real-USER bet / win universe", async () => {
        await Cache.del(CacheKey.adminProfitLoss);
        const res = await get("/api/v1/admin/profit-loss", {
            cookie: adminCookie,
            query: { dateFilter: "today" },
        });
        expect(res.status).toBe(200);
        const cards = res.json?.data?.cardItems ?? {};
        const dist = res.json?.data?.winLossDistribution ?? {};
        const addedBet = WINGO_BET + INOUT_BET;
        const addedWin = WINGO_WIN + INOUT_WIN;
        expect(n(cards.totalInvested)).toBe(snap.plInvested + addedBet);
        expect(n(dist.totalWin)).toBe(snap.plWon + addedWin);
        expect(n(cards.netPL)).toBe(snap.plNet + addedBet - addedWin);
        const games = res.json?.data?.gameStatistics ?? [];
        const inout = games.find((g: { gameName: string }) => g.gameName === "inout");
        expect(inout).toBeTruthy();
        expect(n(inout.totalInvested)).toBeGreaterThanOrEqual(INOUT_BET);
    });

    test("turnover for the real USER is SUCCESS deposits only", async () => {
        const res = await get("/api/v1/admin/turnover", {
            cookie: adminCookie,
            query: { username: real.username, page: 1, limit: 20 },
        });
        expect(res.status).toBe(200);
        const row = (res.json?.data ?? []).find(
            (r: { userId: string }) => r.userId === real.id
        );
        expect(row).toBeTruthy();
        expect(n(row.totalDeposits)).toBe(UPI_OK + MANUAL_OK + YDAY_OK);
        expect(n(row.totalTurnover)).toBe(UPI_OK + MANUAL_OK + YDAY_OK);
        expect(n(row.totalBets)).toBe(WINGO_BET + INOUT_BET);
    });

    test("turnover never lists staff or demo", async () => {
        for (const u of [admin, agent, sub, demo]) {
            const res = await get("/api/v1/admin/turnover", {
                cookie: adminCookie,
                query: { username: u.username, page: 1, limit: 20 },
            });
            const hit = (res.json?.data ?? []).some(
                (r: { userId: string }) => r.userId === u.id
            );
            expect(hit).toBe(false);
        }
    });

    test("top performance never lists staff or demo", async () => {
        await Cache.del(CacheKey.adminTopPerformance);
        const res = await get("/api/v1/admin/top-performance", {
            cookie: adminCookie,
            query: { timeFilter: "all_time" },
        });
        expect(res.status).toBe(200);
        const names = new Set(
            (res.json?.data?.topPerformers ?? []).map(
                (p: { username: string }) => p.username
            )
        );
        expect(names.has(admin.username)).toBe(false);
        expect(names.has(agent.username)).toBe(false);
        expect(names.has(sub.username)).toBe(false);
        expect(names.has(demo.username)).toBe(false);
    });

    test("user-hub team recharge walks only real USER children", async () => {
        await Cache.del(CacheKey.adminUserStats(parent.id));
        const res = await get(`/api/v1/admin/users/${parent.id}`, {
            cookie: adminCookie,
        });
        expect(res.status).toBe(200);
        const stats = res.json?.user?.stats ?? {};
        expect(n(stats.directRecharge)).toBe(CHILD_USER_DEP);
        expect(n(stats.downlinkRecharge)).toBe(CHILD_USER_DEP);
        expect(n(stats.directDownlinksCount)).toBe(1);
        expect(n(stats.allDownlinksCount)).toBe(1);
        expect(n(stats.directRecharge)).not.toBe(
            CHILD_USER_DEP + CHILD_AGENT_DEP + CHILD_DEMO_DEP
        );
    });

    test("user-hub own recharge is SUCCESS only (not pending / failed)", async () => {
        await Cache.del(CacheKey.adminUserStats(real.id));
        const res = await get(`/api/v1/admin/users/${real.id}`, {
            cookie: adminCookie,
        });
        expect(res.status).toBe(200);
        const stats = res.json?.user?.stats ?? {};
        expect(n(stats.totalRecharge)).toBe(UPI_OK + MANUAL_OK + YDAY_OK);
        expect(n(stats.totalWithdraw)).toBe(WD_OK);
        expect(n(stats.totalBet)).toBe(WINGO_BET + INOUT_BET);
    });

    test("Users list still returns staff and demo (ops list)", async () => {
        await Cache.del(CacheKey.adminUsers);
        for (const u of [admin, agent, sub, demo, real]) {
            const res = await get("/api/v1/admin/users/list", {
                cookie: adminCookie,
                query: { page: 1, limit: 20, search: u.username },
            });
            expect(res.status).toBe(200);
            const hit = (res.json?.users ?? []).some(
                (row: { id: string }) => row.id === u.id
            );
            expect(hit).toBe(true);
        }
    });

    test("deposit queue lists real/staff deposits and hides demo deposits by default", async () => {
        await Cache.del(CacheKey.adminDeposits);
        const pending = await get("/api/v1/admin/transactions/deposit", {
            cookie: adminCookie,
            query: { page: 1, limit: 30, userId: real.id, status: "PROCESSING" },
        });
        expect(pending.status).toBe(200);
        expect(
            (pending.json?.deposits ?? []).some(
                (r: { orderId: string }) => r.orderId === oid("pend")
            )
        ).toBe(true);

        const staff = await get("/api/v1/admin/transactions/deposit", {
            cookie: adminCookie,
            query: { page: 1, limit: 30, userId: admin.id },
        });
        expect(staff.status).toBe(200);
        expect(
            (staff.json?.deposits ?? []).some(
                (r: { orderId: string }) => r.orderId === oid("adm")
            )
        ).toBe(true);

        // General queue without userId hides demo deposits
        const allQueue = await get("/api/v1/admin/transactions/deposit", {
            cookie: adminCookie,
            query: { page: 1, limit: 50 },
        });
        expect(allQueue.status).toBe(200);
        expect(
            (allQueue.json?.deposits ?? []).some(
                (r: { orderId: string }) => r.orderId === oid("upi")
            )
        ).toBe(true);
        expect(
            (allQueue.json?.deposits ?? []).some(
                (r: { orderId: string }) => r.orderId === oid("demo")
            )
        ).toBe(false);

        // Explicit userId filter for demo user still shows demo deposits (User Hub)
        const demoHub = await get("/api/v1/admin/transactions/deposit", {
            cookie: adminCookie,
            query: { page: 1, limit: 30, userId: demo.id },
        });
        expect(demoHub.status).toBe(200);
        expect(
            (demoHub.json?.deposits ?? []).some(
                (r: { orderId: string }) => r.orderId === oid("demo")
            )
        ).toBe(true);
    });

    test("withdraw queue lists real/agent withdrawals and hides demo withdrawals by default", async () => {
        await Cache.del(CacheKey.adminWithdrawals);
        const gen = await get("/api/v1/admin/transactions/withdraw", {
            cookie: adminCookie,
            query: { page: 1, limit: 30, userId: real.id, status: "GENERATED" },
        });
        expect(gen.status).toBe(200);
        expect(
            (gen.json?.withdrawals ?? []).some(
                (r: { orderId: string }) => r.orderId === oid("wdgn")
            )
        ).toBe(true);

        const agentRow = await get("/api/v1/admin/transactions/withdraw", {
            cookie: adminCookie,
            query: { page: 1, limit: 30, userId: agent.id },
        });
        expect(agentRow.status).toBe(200);
        expect(
            (agentRow.json?.withdrawals ?? []).some(
                (r: { orderId: string }) => r.orderId === oid("wdag")
            )
        ).toBe(true);

        // General queue without userId hides demo withdrawals
        const allWdQueue = await get("/api/v1/admin/transactions/withdraw", {
            cookie: adminCookie,
            query: { page: 1, limit: 50 },
        });
        expect(allWdQueue.status).toBe(200);
        expect(
            (allWdQueue.json?.withdrawals ?? []).some(
                (r: { orderId: string }) => r.orderId === oid("wdok")
            )
        ).toBe(true);
        expect(
            (allWdQueue.json?.withdrawals ?? []).some(
                (r: { orderId: string }) => r.orderId === oid("wddm")
            )
        ).toBe(false);

        // Explicit userId filter for demo user still shows demo withdrawals (User Hub)
        const demoWdHub = await get("/api/v1/admin/transactions/withdraw", {
            cookie: adminCookie,
            query: { page: 1, limit: 30, userId: demo.id },
        });
        expect(demoWdHub.status).toBe(200);
        expect(
            (demoWdHub.json?.withdrawals ?? []).some(
                (r: { orderId: string }) => r.orderId === oid("wddm")
            )
        ).toBe(true);
    });

    test("balance-adjust does not move SUCCESS recharge", async () => {
        await purgeSummaryCache([real.id]);
        const before = await get("/api/v1/admin/overview", { cookie: adminCookie });
        const successBefore = n(before.json?.data?.deposits?.successAmount);
        const todayBefore = n(before.json?.data?.deposits?.todayAmount);

        const adj = await patch(`/api/v1/admin/users/${real.id}/balance`, {
            cookie: adminCookie,
            json: { amount: ADJUST, reason: "ars-adjust-not-recharge" },
        });
        expect(adj.status).toBe(200);

        await purgeSummaryCache([real.id]);
        const after = await get("/api/v1/admin/overview", { cookie: adminCookie });
        expect(n(after.json?.data?.deposits?.successAmount)).toBe(successBefore);
        expect(n(after.json?.data?.deposits?.todayAmount)).toBe(todayBefore);
    });
});
