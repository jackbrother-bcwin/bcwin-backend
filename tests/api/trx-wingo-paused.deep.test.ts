/**
 * TRX Win Go is live. Consent is required before debit; periods / history stay.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@bcwin/db";
import { TRX_WINGO_BETS_LIVE } from "@bcwin/config";
import {
    FixtureTracker,
    authCookieFor,
    cleanupByUserIds,
    createActiveTrxWingoPeriod,
    createActiveWingoPeriod,
    createTestUser,
    ensureSystemConfig,
    get,
    post,
} from "../helpers";

async function acceptTrxEntry(cookie: string) {
    const entry = await get("/api/v1/trxwingo/entry", { cookie });
    expect(entry.status).toBe(200);
    expect(entry.json?.data?.available).toBe(true);
    if (entry.json?.data?.active) return entry.json.data;
    const accepted = await post("/api/v1/trxwingo/entry", {
        cookie,
        json: { quote: entry.json.data.quote },
    });
    expect(accepted.status).toBe(200);
    expect(accepted.json?.data?.active).toBe(true);
    return accepted.json.data;
}

describe("TRX Win Go live betting", () => {
    const tracker = new FixtureTracker("trxlive");
    let cookie: string;
    let userId: string;
    let balanceBefore = 0;

    beforeAll(async () => {
        await ensureSystemConfig();
        const user = await createTestUser(tracker, { balance: 50_000 });
        userId = user.id;
        cookie = await authCookieFor(user);
        balanceBefore = user.balance;
    });

    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
        });
    });

    test("kill switch is on", () => {
        expect(TRX_WINGO_BETS_LIVE).toBe(true);
    });

    test("POST /trxwingo/bet without consent does not debit", async () => {
        const period = await createActiveTrxWingoPeriod(tracker, 300);
        const res = await post("/api/v1/trxwingo/bet", {
            cookie,
            json: {
                periodId: period.id,
                betType: "COLOR",
                betChoice: "RED",
                betAmount: 10,
            },
        });
        expect(res.status).toBe(400);
        expect(String(res.json?.error ?? "")).toMatch(/Accept the TRX entry wager/i);

        const refreshed = await prisma.user.findUniqueOrThrow({
            where: { id: userId },
        });
        expect(refreshed.balance).toBe(balanceBefore);

        const n = await prisma.trxWingoBet.count({
            where: { userId, periodId: period.id },
        });
        expect(n).toBe(0);
    });

    test("POST /trxwingo/bet after consent places the bet", async () => {
        await acceptTrxEntry(cookie);
        const period = await createActiveTrxWingoPeriod(tracker, 300);
        const res = await post("/api/v1/trxwingo/bet", {
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

        const refreshed = await prisma.user.findUniqueOrThrow({
            where: { id: userId },
        });
        expect(refreshed.balance).toBe(balanceBefore - 10);
        expect(
            await prisma.trxWingoBet.count({
                where: { userId, periodId: period.id },
            })
        ).toBe(1);
    });

    test("GET periods / results / bets still serve", async () => {
        await createActiveTrxWingoPeriod(tracker, 60);
        const periods = await get("/api/v1/trxwingo/periods", {
            cookie,
            query: { page: 1, limit: 10, duration: 60 },
        });
        expect(periods.status).toBe(200);
        expect(periods.json?.success).toBe(true);

        const results = await get("/api/v1/trxwingo/results", {
            cookie,
            query: { page: 1, limit: 10, duration: 60 },
        });
        expect([200, 400]).toContain(results.status);

        const bets = await get("/api/v1/trxwingo/bets", {
            cookie,
            query: { page: 1, limit: 20 },
        });
        expect(bets.status).toBe(200);
        expect(bets.json?.success).toBe(true);
        expect(Array.isArray(bets.json?.bets)).toBe(true);
    });

    test("regular Win Go bets still place", async () => {
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
    });
});
