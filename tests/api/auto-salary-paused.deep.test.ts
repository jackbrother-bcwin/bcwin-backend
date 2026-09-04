/**
 * Auto salary paused (ADR-0041). Dashboard / generate off; TX credited history stays.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AUTO_SALARY_LIVE, AUTO_SALARY_PAUSED_MESSAGE } from "@bcwin/config";
import {
    FixtureTracker,
    authCookieFor,
    cleanupByUserIds,
    createTestUser,
    ensureSystemConfig,
    get,
    post,
} from "../helpers";

describe("Auto salary paused", () => {
    const tracker = new FixtureTracker("asp");
    let cookie: string;

    beforeAll(async () => {
        await ensureSystemConfig();
        const user = await createTestUser(tracker, { balance: 0 });
        cookie = await authCookieFor(user);
    });

    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
            giftCodePrefix: tracker.giftPrefix,
            orderIdPrefix: tracker.orderPrefix,
        });
    });

    test("kill switch is off", () => {
        expect(AUTO_SALARY_LIVE).toBe(false);
    });

    test("player dashboard returns paused", async () => {
        const res = await get("/api/v1/user/salary/dashboard", { cookie });
        expect(res.status).toBe(503);
        expect(String(res.json?.error ?? "")).toBe(AUTO_SALARY_PAUSED_MESSAGE);
    });

    test("read-only team business report remains available", async () => {
        const res = await get("/api/v1/user/salary/business-report", {
            cookie,
            query: { day: "today", sortBy: "deposit", page: 1, limit: 10 },
        });
        expect(res.status).toBe(200);
        expect(res.json?.success).toBe(true);
        expect(res.json?.team).toEqual({
            l1Count: 0,
            deposit: 0,
            withdrawal: 0,
        });
        expect(res.json?.legs).toEqual([]);
    });

    test("credited-only history still serves (transaction ledger)", async () => {
        const res = await get("/api/v1/user/salary", {
            cookie,
            query: { creditedOnly: "true", page: 1, limit: 10 },
        });
        expect(res.status).toBe(200);
        expect(res.json?.success).toBe(true);
        expect(Array.isArray(res.json?.payments)).toBe(true);
    });

    test("panel history without creditedOnly is paused", async () => {
        const res = await get("/api/v1/user/salary", {
            cookie,
            query: { page: 1, limit: 10 },
        });
        expect(res.status).toBe(503);
    });
});

describe("Admin auto generate while paused", () => {
    const tracker = new FixtureTracker("aspa");
    let adminCookie: string;

    beforeAll(async () => {
        await ensureSystemConfig();
        const admin = await createTestUser(tracker, { role: "ADMIN", balance: 0 });
        adminCookie = await authCookieFor(admin);
    });

    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
            giftCodePrefix: tracker.giftPrefix,
            orderIdPrefix: tracker.orderPrefix,
        });
    });

    test("generate claims is paused", async () => {
        const res = await post("/api/v1/admin/salary/auto/generate", {
            cookie: adminCookie,
            json: { periodDate: "2026-08-24" },
        });
        expect(res.status).toBe(503);
        expect(String(res.json?.error ?? "")).toBe(AUTO_SALARY_PAUSED_MESSAGE);
    });
});
