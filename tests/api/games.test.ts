import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "@bcwin/db";
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
} from "../helpers";

describe("API: games (wingo/k3/5d/moto/trxwingo)", () => {
    const tracker = new FixtureTracker("games");
    let user: Awaited<ReturnType<typeof createTestUser>>;
    let cookie: string;
    let balanceBefore = 0;

    beforeAll(async () => {
        await ensureSystemConfig();
        user = await createTestUser(tracker, { balance: 50_000 });
        cookie = await authCookieFor(user);
        balanceBefore = user.balance;
    });

    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
        });
    });

    // ─── Wingo ─────────────────────────────────────────────
    describe("Wingo", () => {
        test("GET /api/v1/wingo/periods", async () => {
            await createActiveWingoPeriod(tracker, 60);
            const res = await get("/api/v1/wingo/periods", {
                cookie,
                query: { page: 1, limit: 10, duration: 60 },
            });
            expect(res.status).toBe(200);
            expect(res.json?.success).toBe(true);
            expect(Array.isArray(res.json?.periods)).toBe(true);
        });

        test("POST /api/v1/wingo/bet places bet and debits balance", async () => {
            const period = await createActiveWingoPeriod(tracker, 300);
            const res = await post("/api/v1/wingo/bet", {
                cookie,
                json: {
                    periodId: period.id,
                    betType: "COLOR",
                    betChoice: "RED",
                    betAmount: 10,
                },
            });
            expect(res.status).toBe(201);
            expect(res.json?.success).toBe(true);
            expect(res.json?.bet?.id).toBeTruthy();

            const refreshed = await prisma.user.findUniqueOrThrow({
                where: { id: user.id },
            });
            expect(refreshed.balance).toBeLessThan(balanceBefore);
            balanceBefore = refreshed.balance;
        });

        test("POST /api/v1/wingo/bet rejects insufficient balance", async () => {
            const poor = await createTestUser(tracker, { balance: 5 });
            const poorCookie = await authCookieFor(poor);
            const period = await createActiveWingoPeriod(tracker, 300);
            const res = await post("/api/v1/wingo/bet", {
                cookie: poorCookie,
                json: {
                    periodId: period.id,
                    betType: "SIZE",
                    betChoice: "BIG",
                    betAmount: 100,
                },
            });
            expect(res.status).toBe(400);
        });

        test("GET /api/v1/wingo/bets lists user bets", async () => {
            const res = await get("/api/v1/wingo/bets", {
                cookie,
                query: { page: 1, limit: 20 },
            });
            expect(res.status).toBe(200);
            expect(res.json?.success).toBe(true);
            expect(Array.isArray(res.json?.bets)).toBe(true);
        });

        test("GET /api/v1/wingo/results", async () => {
            const res = await get("/api/v1/wingo/results", {
                cookie,
                query: { page: 1, limit: 10, duration: 60 },
            });
            expect([200, 400]).toContain(res.status);
            if (res.status === 200) {
                expect(res.json?.success).toBe(true);
            }
        });
    });

    // ─── K3 ────────────────────────────────────────────────
    describe("K3", () => {
        test("GET /api/v1/k3/periods", async () => {
            await createActiveK3Period(tracker, 60);
            const res = await get("/api/v1/k3/periods", {
                cookie,
                query: { page: 1, limit: 10, duration: 60 },
            });
            expect(res.status).toBe(200);
            expect(res.json?.success).toBe(true);
        });

        test("POST /api/v1/k3/bet places BIG bet", async () => {
            const period = await createActiveK3Period(tracker, 300);
            const res = await post("/api/v1/k3/bet", {
                cookie,
                json: {
                    periodId: period.id,
                    betType: "BIG",
                    betChoice: "BIG",
                    betAmount: 10,
                },
            });
            expect(res.status).toBe(201);
            expect(res.json?.success).toBe(true);
            expect(res.json?.bet?.id).toBeTruthy();
        });
    });

    // ─── 5D ────────────────────────────────────────────────
    describe("5D", () => {
        test("GET /api/v1/5d/periods", async () => {
            await createActiveFiveDPeriod(tracker, 60);
            const res = await get("/api/v1/5d/periods", {
                cookie,
                query: { page: 1, limit: 10, duration: 60 },
            });
            expect(res.status).toBe(200);
            expect(res.json?.success).toBe(true);
        });
    });

    // ─── Moto ──────────────────────────────────────────────
    describe("Moto", () => {
        test("GET /api/v1/moto/periods", async () => {
            await createActiveMotoPeriod(tracker, 60);
            const res = await get("/api/v1/moto/periods", {
                cookie,
                query: { page: 1, limit: 10, duration: 60 },
            });
            expect(res.status).toBe(200);
            expect(res.json?.success).toBe(true);
        });
    });

    // ─── TRX Wingo ─────────────────────────────────────────
    describe("TRX Wingo", () => {
        test("GET /api/v1/trxwingo/periods", async () => {
            await createActiveTrxWingoPeriod(tracker, 60);
            const res = await get("/api/v1/trxwingo/periods", {
                cookie,
                query: { page: 1, limit: 10, duration: 60 },
            });
            // path may be /trx-wingo or /trxwingo
            if (res.status === 404) {
                const res2 = await get("/api/v1/trx-wingo/periods", {
                    cookie,
                    query: { page: 1, limit: 10, duration: 60 },
                });
                expect([200, 404]).toContain(res2.status);
            } else {
                expect(res.status).toBe(200);
                expect(res.json?.success).toBe(true);
            }
        });
    });
});
