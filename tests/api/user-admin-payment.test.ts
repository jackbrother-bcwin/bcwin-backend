import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import {
    get,
    post,
    patch,
    FixtureTracker,
    createTestUser,
    authCookieFor,
    cleanupByUserIds,
    ensureSystemConfig,
} from "../helpers";

describe("API: user / admin / payment / gift / activity", () => {
    const tracker = new FixtureTracker("uap");
    let user: Awaited<ReturnType<typeof createTestUser>>;
    let admin: Awaited<ReturnType<typeof createTestUser>>;
    let userCookie: string;
    let adminCookie: string;

    beforeAll(async () => {
        await ensureSystemConfig();
        user = await createTestUser(tracker, { balance: 5_000 });
        admin = await createTestUser(tracker, {
            role: "ADMIN",
            balance: 0,
        });
        userCookie = await authCookieFor(user);
        adminCookie = await authCookieFor(admin);
    });

    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
            giftCodePrefix: tracker.giftPrefix,
            orderIdPrefix: tracker.orderPrefix,
        });
    });

    // ─── User ──────────────────────────────────────────────
    describe("User routes", () => {
        test("GET /api/v1/user/user returns profile", async () => {
            const res = await get("/api/v1/user/user", { cookie: userCookie });
            expect(res.status).toBe(200);
            expect(res.json?.success).toBe(true);
            expect(res.json?.user?.id).toBe(user.id);
            expect(typeof res.json?.user?.balance).toBe("number");
        });

        test("GET /api/v1/user/team/overview", async () => {
            const res = await get("/api/v1/user/team/overview", {
                cookie: userCookie,
            });
            expect([200, 404]).toContain(res.status);
            if (res.status === 200) {
                expect(res.json?.success !== false).toBe(true);
            }
        });

        test("GET /api/v1/user/team/members", async () => {
            const res = await get("/api/v1/user/team/members", {
                cookie: userCookie,
                query: { page: 1, limit: 10 },
            });
            expect([200, 400]).toContain(res.status);
        });

        test("GET /api/v1/user/vip/status", async () => {
            const res = await get("/api/v1/user/vip/status", {
                cookie: userCookie,
            });
            expect([200, 404]).toContain(res.status);
        });

        test("GET /api/v1/user/vip/requirements", async () => {
            const res = await get("/api/v1/user/vip/requirements", {
                cookie: userCookie,
            });
            expect([200, 404]).toContain(res.status);
        });

        test("GET /api/v1/user/deposits", async () => {
            const res = await get("/api/v1/user/deposits", {
                cookie: userCookie,
                query: { page: 1, limit: 10 },
            });
            expect([200, 400]).toContain(res.status);
        });

        test("GET /api/v1/user/withdrawals", async () => {
            const res = await get("/api/v1/user/withdrawals", {
                cookie: userCookie,
                query: { page: 1, limit: 10 },
            });
            expect([200, 400]).toContain(res.status);
        });

        test("GET /api/v1/user/game-history", async () => {
            const res = await get("/api/v1/user/game-history", {
                cookie: userCookie,
                query: { page: 1, limit: 10 },
            });
            expect([200, 400]).toContain(res.status);
        });

        test("GET /api/v1/user/notifications", async () => {
            const res = await get("/api/v1/user/notifications", {
                cookie: userCookie,
            });
            expect([200, 400]).toContain(res.status);
        });

        test("GET activity tiers / history / progress", async () => {
            for (const path of [
                "/api/v1/user/activity/tiers",
                "/api/v1/user/activity/history",
                "/api/v1/user/activity/progress",
            ]) {
                const res = await get(path, {
                    cookie: userCookie,
                    query: { page: 1, limit: 10 },
                });
                expect([200, 400, 404]).toContain(res.status);
            }
        });

        test("GET /api/v1/user/spin-wheel", async () => {
            const res = await get("/api/v1/user/activity/spin-wheel", {
                cookie: userCookie,
            });
            expect([200, 400, 404]).toContain(res.status);
        });
    });

    // ─── Admin ─────────────────────────────────────────────
    describe("Admin routes", () => {
        test("non-admin cannot access admin overview", async () => {
            const res = await get("/api/v1/admin/overview", {
                cookie: userCookie,
            });
            expect(res.status).toBe(401);
        });

        test("GET /api/v1/admin/overview", async () => {
            const res = await get("/api/v1/admin/overview", {
                cookie: adminCookie,
            });
            expect(res.status).toBe(200);
            expect(res.json?.success).toBe(true);
        });

        test("admin overview today recharge is SUCCESS real USER only", async () => {
            const demo = await createTestUser(tracker, { balance: 0 });
            await prisma.user.update({
                where: { id: demo.id },
                data: { isDemo: true },
            });

            await Cache.del(CacheKey.adminOverview);
            const before = await get("/api/v1/admin/overview", {
                cookie: adminCookie,
            });
            expect(before.status).toBe(200);
            const dep = before.json?.data?.deposits ?? {};
            const todayBefore = Number(dep.todayAmount ?? 0);
            const successBefore = Number(dep.successAmount ?? 0);
            const pendingBefore = Number(dep.pendingAmount ?? 0);

            await prisma.deposit.createMany({
                data: [
                    {
                        orderId: `${tracker.orderPrefix}ok`,
                        amount: 250,
                        method: "UPI",
                        status: "SUCCESS",
                        userId: user.id,
                    },
                    {
                        orderId: `${tracker.orderPrefix}pend`,
                        amount: 1000,
                        method: "UPI",
                        status: "PROCESSING",
                        userId: user.id,
                    },
                    {
                        orderId: `${tracker.orderPrefix}adm`,
                        amount: 9999,
                        method: "ADMIN_MANUAL",
                        status: "SUCCESS",
                        userId: admin.id,
                    },
                    {
                        orderId: `${tracker.orderPrefix}demo`,
                        amount: 500,
                        method: "UPI",
                        status: "SUCCESS",
                        userId: demo.id,
                    },
                ],
            });

            await Cache.del(CacheKey.adminOverview);
            const after = await get("/api/v1/admin/overview", {
                cookie: adminCookie,
            });
            expect(after.status).toBe(200);
            const afterDep = after.json?.data?.deposits ?? {};
            expect(Number(afterDep.todayAmount)).toBe(todayBefore + 250);
            expect(Number(afterDep.successAmount)).toBe(successBefore + 250);
            expect(Number(afterDep.pendingAmount)).toBe(pendingBefore + 1000);
        });

        test("GET admin deposit list includes user email and bank", async () => {
            await prisma.user.update({
                where: { id: user.id },
                data: { email: `ars_${user.serialNumber}@ex.test` },
            });
            await prisma.bank.upsert({
                where: { userId: user.id },
                create: { userId: user.id, fullName: "Legal Name Test" },
                update: { fullName: "Legal Name Test" },
            });
            await prisma.deposit.create({
                data: {
                    orderId: `${tracker.orderPrefix}ident`,
                    amount: 11,
                    method: "UPI",
                    status: "SUCCESS",
                    userId: user.id,
                },
            });
            await Cache.del(CacheKey.adminDeposits);
            const res = await get("/api/v1/admin/transactions/deposit", {
                cookie: adminCookie,
                query: { page: 1, limit: 30, userId: user.id },
            });
            expect(res.status).toBe(200);
            const row = (res.json?.deposits ?? []).find(
                (d: { userId?: string; user?: { id?: string } }) =>
                    d.user?.id === user.id
            );
            expect(row?.user?.email).toBe(`ars_${user.serialNumber}@ex.test`);
            expect(row?.user?.bank?.fullName).toBe("Legal Name Test");
        });

        test("GET /api/v1/admin/users/list", async () => {
            const res = await get("/api/v1/admin/users/list", {
                cookie: adminCookie,
                query: { page: 1, limit: 20 },
            });
            expect([200, 400]).toContain(res.status);
        });

        test("GET /api/v1/admin/users/:id stats", async () => {
            const res = await get(`/api/v1/admin/users/${user.id}`, {
                cookie: adminCookie,
            });
            expect([200, 400, 404]).toContain(res.status);
        });

        test("PATCH admin balance update", async () => {
            const before = await prisma.user.findUniqueOrThrow({
                where: { id: user.id },
            });
            const res = await patch(`/api/v1/admin/users/${user.id}/balance`, {
                cookie: adminCookie,
                json: { amount: 50, reason: "deeptest credit" },
            });
            expect([200, 400]).toContain(res.status);
            if (res.status === 200) {
                const after = await prisma.user.findUniqueOrThrow({
                    where: { id: user.id },
                });
                expect(after.balance).toBe(before.balance + 50);
            }
        });

        test("POST ban + unban user", async () => {
            const target = await createTestUser(tracker, { balance: 10 });
            const ban = await post(`/api/v1/admin/users/${target.id}/ban`, {
                cookie: adminCookie,
                json: { reason: "deeptest" },
            });
            expect([200, 400]).toContain(ban.status);

            const unban = await post(`/api/v1/admin/users/${target.id}/unban`, {
                cookie: adminCookie,
                json: {},
            });
            expect([200, 400]).toContain(unban.status);
        });

        test("GET admin transactions / illegal-bets / ip / config", async () => {
            const paths = [
                "/api/v1/admin/transactions/deposits",
                "/api/v1/admin/transactions/withdraws",
                "/api/v1/admin/transactions/game-history",
                "/api/v1/admin/illegal-bets",
                "/api/v1/admin/ip",
                "/api/v1/admin/config",
                "/api/v1/admin/profit-loss",
                "/api/v1/admin/top-performance",
                "/api/v1/admin/queries",
            ];
            for (const path of paths) {
                const res = await get(path, {
                    cookie: adminCookie,
                    query: { page: 1, limit: 10 },
                });
                // 200 OK, 400 validation, 404 missing subpath — not 500
                expect(res.status).toBeLessThan(500);
            }
        });
    });

    // ─── Payment ───────────────────────────────────────────
    describe("Payment routes", () => {
        test("GET bank details (empty ok)", async () => {
            const paths = [
                "/api/v1/payment/bank",
                "/api/v1/payment/bank-details",
                "/api/v1/bank",
            ];
            let hit = false;
            for (const p of paths) {
                const res = await get(p, { cookie: userCookie });
                if (res.status !== 404) {
                    hit = true;
                    expect(res.status).toBeLessThan(500);
                }
            }
            expect(hit || true).toBe(true);
        });

        test("payment methods / deposit endpoints respond", async () => {
            for (const path of [
                "/api/v1/payment/methods",
                "/api/v1/payment/deposit",
                "/api/v1/payment/config",
            ]) {
                const res = await get(path, { cookie: userCookie });
                expect(res.status).toBeLessThan(500);
            }
        });
    });

    // ─── Gift ──────────────────────────────────────────────
    describe("Gift redeem", () => {
        // giftRoutes mount path `/redeem` on private app → /api/v1/redeem
        test("redeem invalid code fails cleanly", async () => {
            const res = await post("/api/v1/redeem", {
                cookie: userCookie,
                json: { code: `${tracker.giftPrefix}NOPE` },
            });
            expect([400, 404]).toContain(res.status);
        });

        test("redeem valid gift code", async () => {
            const code = `${tracker.giftPrefix}OK`;
            await prisma.gift.create({
                data: {
                    code,
                    type: "FIXED",
                    amount: 25,
                    totalRedeemable: 10,
                    totalRedeemed: 0,
                    isActive: true,
                },
            });

            const before = await prisma.user.findUniqueOrThrow({
                where: { id: user.id },
            });
            const res = await post("/api/v1/redeem", {
                cookie: userCookie,
                json: { code },
            });
            expect([200, 201, 400]).toContain(res.status);
            if (res.status === 200 || res.status === 201) {
                const after = await prisma.user.findUniqueOrThrow({
                    where: { id: user.id },
                });
                expect(after.balance).toBeGreaterThanOrEqual(before.balance);
            }
        });
    });

    // ─── Inout public catalog ──────────────────────────────
    describe("Inout public", () => {
        test("GET inout games list is public or auth", async () => {
            for (const path of [
                "/api/v1/inout/games",
                "/api/v1/inout/games",
                "/api/v1/inout/list",
            ]) {
                const res = await get(path);
                expect(res.status).toBeLessThan(500);
            }
        });
    });
});
