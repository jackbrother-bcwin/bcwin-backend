/**
 * Public Win Go API around lock-window prepare / 00 handoff.
 * Result is stored during lock but must not appear on GET until endTime.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "@bcwin/db";
import {
    get,
    post,
    FixtureTracker,
    createTestUser,
    createWingoPeriod,
    authCookieFor,
    cleanupByUserIds,
    ensureSystemConfig,
} from "../helpers";

function colorSize(n: number) {
    return {
        resultNumber: n,
        resultColor: (n % 2 === 0 ? "RED" : "GREEN") as "RED" | "GREEN",
        resultSize: (n >= 5 ? "BIG" : "SMALL") as "BIG" | "SMALL",
    };
}

async function placeBet(
    cookie: string,
    periodId: string,
    extra: Record<string, unknown> = {}
) {
    return post("/api/v1/wingo/bet", {
        cookie,
        json: {
            periodId,
            betType: "COLOR",
            betChoice: "RED",
            betAmount: 10,
            ...extra,
        },
    });
}

describe("Deep: Win Go lock-window public API", () => {
    const tracker = new FixtureTracker("wglockapi");
    let cookie: string;

    beforeAll(async () => {
        await ensureSystemConfig();
        const user = await createTestUser(tracker, { balance: 50_000 });
        cookie = await authCookieFor(user);
    });

    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
        });
    });

    test("currentPeriod is the started live slot, never the pre-created next", async () => {
        const now = Date.now();
        const live = await createWingoPeriod(tracker, {
            durationSeconds: 300,
            startTime: new Date(now - 5_000),
            endTime: new Date(now + 120_000),
            suffix: "cur",
        });
        const next = await createWingoPeriod(tracker, {
            durationSeconds: 300,
            startTime: new Date(now + 120_000),
            endTime: new Date(now + 420_000),
            suffix: "nxt",
        });

        const res = await get("/api/v1/wingo/periods", {
            cookie,
            query: { page: 1, limit: 20, duration: 300 },
        });
        expect(res.status).toBe(200);
        expect(res.json?.success).toBe(true);

        const current = res.json?.currentPeriod;
        expect(current).toBeTruthy();
        expect(current.id).not.toBe(next.id);
        expect(new Date(current.startTime).getTime()).toBeLessThanOrEqual(
            Date.now()
        );
        expect(new Date(current.endTime).getTime()).toBeGreaterThan(Date.now());

        const ids = (res.json?.periods ?? []).map((p: { id: string }) => p.id);
        expect(ids).toContain(live.id);
        expect(ids).toContain(next.id);
    });

    test("stored result is hidden on periods until endTime, then public on results", async () => {
        const live = await createWingoPeriod(tracker, {
            durationSeconds: 180,
            startTime: new Date(Date.now() - 2_000),
            endTime: new Date(Date.now() + 90_000),
            ...colorSize(8),
            suffix: "hid",
        });

        const periods = await get("/api/v1/wingo/periods", {
            cookie,
            query: { page: 1, limit: 30, duration: 180 },
        });
        expect(periods.status).toBe(200);
        const listed = (periods.json?.periods ?? []).find(
            (p: { id: string }) => p.id === live.id
        );
        expect(listed).toBeTruthy();
        expect(listed.resultNumber).toBeNull();
        expect(listed.resultColor).toBeNull();
        expect(listed.resultSize).toBeNull();

        if (periods.json?.currentPeriod?.id === live.id) {
            expect(periods.json.currentPeriod.resultNumber).toBeNull();
        }

        const hiddenList = await get("/api/v1/wingo/results", {
            cookie,
            query: { page: 1, limit: 30, duration: 180 },
        });
        expect(hiddenList.status).toBe(200);
        const leaked = (hiddenList.json?.results ?? []).find(
            (r: { id: string }) => r.id === live.id
        );
        expect(leaked).toBeUndefined();

        const hiddenOne = await get(`/api/v1/wingo/results/${live.id}`, {
            cookie,
        });
        expect(hiddenOne.status).toBe(404);

        await prisma.wingoPeriod.update({
            where: { id: live.id },
            data: { endTime: new Date(Date.now() - 500), status: "ENDED" },
        });

        const shownList = await get("/api/v1/wingo/results", {
            cookie,
            query: { page: 1, limit: 30, duration: 180 },
        });
        const shown = (shownList.json?.results ?? []).find(
            (r: { id: string }) => r.id === live.id
        );
        expect(shown).toBeTruthy();
        expect(shown.resultNumber).toBe(8);
        expect(shown.resultColor).toBe("RED");
        expect(shown.resultSize).toBe("BIG");

        const shownOne = await get(`/api/v1/wingo/results/${live.id}`, {
            cookie,
        });
        expect(shownOne.status).toBe(200);
        expect(shownOne.json?.result?.resultNumber).toBe(8);
    });

    test("place-bet allowed mid-period, rejected in lock, before start, and after end", async () => {
        const now = Date.now();
        const open = await createWingoPeriod(tracker, {
            durationSeconds: 300,
            startTime: new Date(now - 1_000),
            endTime: new Date(now + 120_000),
            suffix: "open",
        });
        const locked30 = await createWingoPeriod(tracker, {
            durationSeconds: 30,
            startTime: new Date(now - 26_000),
            endTime: new Date(now + 3_000),
            suffix: "lk30",
        });
        const locked300 = await createWingoPeriod(tracker, {
            durationSeconds: 300,
            startTime: new Date(now - 292_000),
            endTime: new Date(now + 4_000),
            suffix: "lk300",
        });
        const future = await createWingoPeriod(tracker, {
            durationSeconds: 300,
            startTime: new Date(now + 30_000),
            endTime: new Date(now + 330_000),
            suffix: "fut",
        });
        const ended = await createWingoPeriod(tracker, {
            durationSeconds: 300,
            startTime: new Date(now - 400_000),
            endTime: new Date(now - 100_000),
            status: "ENDED",
            suffix: "end",
        });

        const ok = await placeBet(cookie, open.id);
        expect(ok.status).toBe(201);
        expect(ok.json?.success).toBe(true);

        const lock30 = await placeBet(cookie, locked30.id);
        expect(lock30.status).toBe(400);
        expect(String(lock30.json?.error ?? "")).toMatch(/locked/i);

        const lockLong = await placeBet(cookie, locked300.id);
        expect(lockLong.status).toBe(400);
        expect(String(lockLong.json?.error ?? "")).toMatch(/locked/i);

        const tooSoon = await placeBet(cookie, future.id);
        expect(tooSoon.status).toBe(400);
        expect(String(tooSoon.json?.error ?? "")).toMatch(/locked/i);

        const dead = await placeBet(cookie, ended.id);
        expect(dead.status).toBe(400);
        expect(String(dead.json?.error ?? "")).toMatch(/not active/i);
    });

    test("30s period still accepts bets 6s before end and rejects at 5s", async () => {
        const now = Date.now();
        const stillOpen = await createWingoPeriod(tracker, {
            durationSeconds: 30,
            startTime: new Date(now - 22_000),
            endTime: new Date(now + 8_000),
            suffix: "s6",
        });
        const justLocked = await createWingoPeriod(tracker, {
            durationSeconds: 30,
            startTime: new Date(now - 26_000),
            endTime: new Date(now + 4_000),
            suffix: "s4",
        });

        const ok = await placeBet(cookie, stillOpen.id, {
            betType: "SIZE",
            betChoice: "BIG",
        });
        expect(ok.status).toBe(201);

        const no = await placeBet(cookie, justLocked.id, {
            betType: "SIZE",
            betChoice: "SMALL",
        });
        expect(no.status).toBe(400);
        expect(String(no.json?.error ?? "")).toMatch(/locked/i);
    });

    test("after live slot is ended, next started slot is currentPeriod with remaining time", async () => {
        const now = Date.now();
        const prev = await createWingoPeriod(tracker, {
            durationSeconds: 60,
            startTime: new Date(now - 90_000),
            endTime: new Date(now - 1_000),
            status: "ENDED",
            ...colorSize(1),
            suffix: "prev",
        });
        const next = await createWingoPeriod(tracker, {
            durationSeconds: 60,
            startTime: new Date(now - 500),
            endTime: new Date(now + 59_500),
            suffix: "live2",
        });

        const res = await get("/api/v1/wingo/periods", {
            cookie,
            query: { page: 1, limit: 20, duration: 60 },
        });
        expect(res.status).toBe(200);
        const current = res.json?.currentPeriod;
        expect(current).toBeTruthy();
        expect(current.id).not.toBe(prev.id);
        expect(new Date(current.endTime).getTime()).toBeGreaterThan(Date.now());
        const remainingSec =
            (new Date(current.endTime).getTime() - Date.now()) / 1000;
        expect(remainingSec).toBeGreaterThan(20);

        const listedNext = (res.json?.periods ?? []).find(
            (p: { id: string }) => p.id === next.id
        );
        expect(listedNext).toBeTruthy();
        expect(listedNext.resultNumber).toBeNull();
    });
});
