import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@bcwin/db";
import { applyIllegalRoundPenalty, detectSettledIllegalBets } from "@bcwin/illegal-bets";
import { comparePenaltyWager, getUserWagerStatusReadOnly } from "@bcwin/wager";
import {
    FixtureTracker, createTestUser, authCookieFor, ensureSystemConfig,
    cleanupByUserIds, createActiveWingoPeriod, post, get,
} from "../helpers";

describe("User illegal activity history", () => {
    const tracker = new FixtureTracker("penhistory");
    let adminCookie: string;
    let baseFactor: number;
    let penaltyFactor: number;
    beforeAll(async () => {
        const config = await ensureSystemConfig();
        baseFactor = config.wager;
        penaltyFactor = config.illegalBetPenaltyFactor;
        adminCookie = await authCookieFor(await createTestUser(tracker, { role: "ADMIN" }));
    });
    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, { periodPrefix: tracker.periodPrefix });
    });
    async function fixture() {
        const user = await createTestUser(tracker, { balance: 10_000 });
        await prisma.wagerRequirement.create({ data: {
            userId: user.id, sourceType: "RECHARGE", amount: 1_000,
            multiplier: baseFactor, requiredWager: Math.ceil(1_000 * baseFactor),
            createdAt: new Date(Date.now() - 60_000),
        } });
        return { user, cookie: await authCookieFor(user) };
    }
    const history = (cookie: string, query = "") => get(`/api/v1/user/illegal-activity${query}`, { cookie });
    const manual = (userId: string, factor?: number, reason = "ADMIN") => post(`/api/v1/admin/users/${userId}/penalty`, {
        cookie: adminCookie, json: { hasIllegalBetPenalty: factor != null, illegalBetPenaltyFactor: factor, reason },
    });
    const place = (cookie: string, periodId: string, choice: string, amount: number) => post("/api/v1/wingo/bet", {
        cookie, json: { periodId, betType: "SIZE", betChoice: choice, betAmount: amount },
    });

    test("unequal stakes record exact factor and amount once per round, with settlement deduplication", async () => {
        const { user, cookie } = await fixture();
        const period = await createActiveWingoPeriod(tracker, 300);
        expect((await place(cookie, period.id, "BIG", 100)).status).toBe(201);
        expect((await place(cookie, period.id, "SMALL", 40)).status).toBe(201);
        const event = await prisma.penaltyHistoryEvent.findFirstOrThrow({ where: { userId: user.id } });
        expect(event.previousFactor).toBe(baseFactor);
        expect(event.resultingFactor).toBe(penaltyFactor);
        expect(event.beforeNeedToBet).toBe(Math.max(0, Math.ceil(1_000 * baseFactor - 140)));
        expect(event.afterNeedToBet).toBe(Math.max(0, Math.ceil(1_000 * penaltyFactor - 140)));
        expect((event.evidence as Array<{ amount: number }>).map((b) => b.amount).sort((a, b) => a - b)).toEqual([40, 100]);
        expect(event.periodNumber).toBe(period.periodNumber);
        expect((await place(cookie, period.id, "BIG", 20)).status).toBe(201);
        const bets = await prisma.wingoBet.findMany({ where: { userId: user.id } });
        await detectSettledIllegalBets("WINGO", bets);
        expect(await prisma.penaltyHistoryEvent.count({ where: { userId: user.id } })).toBe(1);
        const response = await history(cookie);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(response.json.total).toBe(1);
        expect(response.json.items[0].afterNeedToBet).toBe(event.afterNeedToBet);
        expect(response.json.current.totalNeedToBet).toBe(Math.max(0, Math.ceil(1_000 * penaltyFactor - 160)));
    });

    test("manual same-IP, adjustment, no-op, and clearance preserve immutable application amounts", async () => {
        const { user, cookie } = await fixture();
        expect((await manual(user.id, 5, "SAME_IP")).status).toBe(200);
        expect((await manual(user.id, 5, "SAME_IP")).status).toBe(200);
        expect((await manual(user.id, 7)).status).toBe(200);
        expect((await manual(user.id)).status).toBe(200);
        const response = await history(cookie);
        expect(response.status).toBe(200);
        expect(response.json.items.map((e: { action: string }) => e.action)).toEqual(["CLEARED", "ADJUSTED", "APPLIED"]);
        expect(response.json.items[2]).toMatchObject({ reason: "SAME_IP", afterNeedToBet: 5_000, resultingFactor: 5, evidence: [] });
        expect(response.json.current.penaltyWagerNeeded).toBe(0);
        expect(response.json.current.totalNeedToBet).toBe(Math.ceil(1_000 * baseFactor));
        expect((await history(cookie, "?reason=SAME_IP")).json.total).toBe(1);
        expect((await history(cookie, "?reason=ADMIN")).json.total).toBe(2);
    });

    test("extra-wager clearance distinguishes reward relief and is not duplicated by legacy audit", async () => {
        const { user, cookie } = await fixture();
        await manual(user.id, 5);
        await prisma.wagerRequirement.create({ data: {
            userId: user.id, sourceType: "REWARD", amount: 100, multiplier: 4, requiredWager: 400,
            createdAt: new Date(Date.now() - 30_000),
        } });
        const cleared = await post(`/api/v1/admin/users/${user.id}/clear-extra-wagers`, {
            cookie: adminCookie, json: { reason: "PRIVATE ADMIN NOTE must not be exposed" },
        });
        expect(cleared.status).toBe(200);
        const response = await history(cookie);
        expect(response.json.total).toBe(2);
        expect(response.json.items[0]).toMatchObject({
            action: "EXTRA_WAGERS_CLEARED", beforeRewardWager: 400, afterRewardWager: 0,
            beforeNeedToBet: 5_400, afterNeedToBet: Math.ceil(1_000 * baseFactor),
        });
        expect(JSON.stringify(response.json)).not.toContain("PRIVATE ADMIN");
        expect(JSON.stringify(response.json)).not.toContain("clearedById");
    });

    test("legacy grouped and unkeyed evidence keeps unknown amounts null and hides private clearance notes", async () => {
        const { user, cookie } = await fixture();
        const prefix = `WINGO:${crypto.randomUUID()}:${user.id}:`;
        await prisma.illegalBet.createMany({ data: [
            { userId: user.id, betGame: "WINGO", betType: "BIG_SMALL", betAmount: 100, penaltyEventKey: `${prefix}a:b` },
            { userId: user.id, betGame: "WINGO", betType: "BIG_SMALL", betAmount: 40, penaltyEventKey: `${prefix}c:d` },
            { userId: user.id, betGame: "K3", betType: "ODD_EVEN", betAmount: 25 },
        ] });
        const admin = await createTestUser(tracker, { role: "ADMIN" });
        await prisma.wagerClearEvent.create({ data: {
            userId: user.id, clearedById: admin.id, reason: "PRIVATE OLD NOTE", previousPenaltyFactor: 3,
            baseWagerFactor: 1, beforeDepositWagerNeeded: 50, afterDepositWagerNeeded: 50,
            beforeRewardWagerNeeded: 200, afterRewardWagerNeeded: 0,
        } });
        const response = await history(cookie);
        expect(response.status).toBe(200);
        expect(response.json.total).toBe(3);
        expect(response.json.items.every((e: { legacy: boolean }) => e.legacy)).toBe(true);
        const grouped = response.json.items.find((e: { game: string }) => e.game === "WINGO");
        expect(grouped.evidence).toHaveLength(2);
        expect(grouped.evidence[0].recordedStakeOnly).toBe(true);
        expect(grouped.previousFactor).toBeNull();
        expect(grouped.afterNeedToBet).toBeNull();
        const clear = response.json.items.find((e: { action: string }) => e.action === "EXTRA_WAGERS_CLEARED");
        expect(clear.beforePenaltyWager).toBeNull();
        expect(clear.beforeRewardWager).toBe(200);
        expect(JSON.stringify(response.json)).not.toContain("PRIVATE OLD NOTE");
    });

    test("date boundaries, stable pages, input validation and authenticated user isolation", async () => {
        const { user, cookie } = await fixture();
        const other = await fixture();
        const data = { userId: user.id, action: "ADJUSTED", reason: "ADMIN", previousFactor: 3, resultingFactor: 5,
            beforeNeedToBet: 300, afterNeedToBet: 500, beforePenaltyWager: 200, afterPenaltyWager: 400,
            beforeRewardWager: 0, afterRewardWager: 0 };
        await prisma.penaltyHistoryEvent.createMany({ data: Array.from({ length: 25 }, (_, i) => ({
            ...data, id: `${tracker.runId}-page-${String(i).padStart(2, "0")}`, createdAt: new Date("2026-01-01T18:30:00.000Z"),
        })) });
        await prisma.penaltyHistoryEvent.createMany({ data: [
            { ...data, createdAt: new Date("2026-01-01T18:29:59.999Z") },
            { ...data, createdAt: new Date("2026-01-02T18:30:00.000Z") },
            { ...data, userId: other.user.id, createdAt: new Date("2026-01-01T18:30:00.000Z") },
        ] });
        const query = "?startDate=2026-01-02&endDate=2026-01-02";
        const first = await history(cookie, query);
        const second = await history(cookie, `${query}&page=2&asOf=${encodeURIComponent(first.json.asOf)}`);
        expect(first.status).toBe(200);
        expect(first.json.total).toBe(25);
        expect(first.json.items).toHaveLength(20);
        expect(second.json.items).toHaveLength(5);
        expect(new Set([...first.json.items, ...second.json.items].map((e) => e.id)).size).toBe(25);
        expect(first.json.items[0].id).toBe(`${tracker.runId}-page-24`);
        expect((await history(cookie, "?page=50")).json.items).toEqual([]);
        expect((await history(other.cookie, `?userId=${user.id}`)).json.total).toBe(1);
        expect((await get("/api/v1/user/illegal-activity")).status).toBe(401);
        for (const bad of ["?page=51", "?page=0", "?limit=500", "?startDate=2026-02-30", "?reason=WRONG", "?startDate=2026-02-01&endDate=2026-01-01"]) {
            expect((await history(cookie, bad)).status).toBe(400);
        }
    });

    test("comparison matches the canonical read for shared-timestamp rewards and reopened requirements", async () => {
        const { user } = await fixture();
        const at = new Date(Date.now() - 60_000);
        await prisma.wagerRequirement.updateMany({ where: { userId: user.id }, data: {
            createdAt: at, requiredWager: 1_000, multiplier: 1, isCleared: true,
        } });
        await prisma.wagerRequirement.create({ data: {
            userId: user.id, sourceType: "REWARD", amount: 100, multiplier: 4, requiredWager: 400, createdAt: at,
        } });
        const period = await createActiveWingoPeriod(tracker, 300);
        await prisma.wingoBet.create({ data: {
            userId: user.id, periodId: period.id, betAmount: 1_200, contractAmount: 1_176,
            betType: "SIZE", betChoice: "BIG",
        } });
        const config = { wager: 1, illegalBetPenaltyFactor: 3 };
        for (const beforeFactor of [1, 3, 5]) for (const afterFactor of [1, 3, 5]) {
            const previous = { ...user, hasIllegalBetPenalty: beforeFactor !== 1, illegalBetPenaltyFactor: beforeFactor };
            const next = { hasIllegalBetPenalty: afterFactor !== 1, illegalBetPenaltyFactor: afterFactor };
            const comparison = await prisma.$transaction((tx) => comparePenaltyWager(tx, user.id, previous, config, next));
            expect(comparison.before).toEqual(await getUserWagerStatusReadOnly(user.id, previous, config));
            expect(comparison.after).toEqual(await getUserWagerStatusReadOnly(user.id, { ...previous, ...next }, config));
        }
    });

    test("concurrent manual and automatic penalties produce a serialized factor history", async () => {
        const { user, cookie } = await fixture();
        const period = await createActiveWingoPeriod(tracker, 300);
        await place(cookie, period.id, "BIG", 100);
        const results = await Promise.all([
            place(cookie, period.id, "SMALL", 40), manual(user.id, 5, "SAME_IP"),
        ]);
        expect(results.map((r) => r.status)).toEqual([201, 200]);
        const events = await prisma.penaltyHistoryEvent.findMany({
            where: { userId: user.id }, orderBy: { createdAt: "asc" },
        });
        expect(events).toHaveLength(2);
        expect(events[0].previousFactor).toBe(baseFactor);
        expect(events[1].previousFactor).toBe(events[0].resultingFactor);
        const current = await getUserWagerStatusReadOnly(user.id);
        expect(current.totalNeedToBet).toBe(events[1].afterNeedToBet);
    });

    test("history cutoff excludes newly applied penalties while current amounts stay live", async () => {
        const { user, cookie } = await fixture();
        await manual(user.id, 3);
        const first = await history(cookie);
        await new Promise((resolve) => setTimeout(resolve, 5));
        await manual(user.id, 5);
        const snapshot = await history(cookie, `?asOf=${encodeURIComponent(first.json.asOf)}`);
        expect(snapshot.json.total).toBe(1);
        expect(snapshot.json.items[0].resultingFactor).toBe(3);
        expect(snapshot.json.current.totalNeedToBet).toBe(5_000);
        expect((await history(cookie)).json.total).toBe(2);
    });

    test("full-number coverage records individual stakes in one application", async () => {
        const { user } = await fixture();
        const period = await createActiveWingoPeriod(tracker, 300);
        const bets = Array.from({ length: 10 }, (_, i) => ({
            id: crypto.randomUUID(), userId: user.id, periodId: period.id,
            betAmount: 10, betType: "NUMBER", betChoice: String(i),
        }));
        await detectSettledIllegalBets("WINGO", bets);
        await detectSettledIllegalBets("WINGO", bets);
        const events = await prisma.penaltyHistoryEvent.findMany({ where: { userId: user.id } });
        expect(events).toHaveLength(1);
        expect(events[0].evidence).toHaveLength(10);
    });

    test("comparison stays bounded on a larger betting history", async () => {
        const { user } = await fixture();
        const period = await createActiveWingoPeriod(tracker, 300);
        const start = new Date(Date.now() - 50_000);
        await prisma.wingoBet.createMany({ data: Array.from({ length: 5_000 }, (_, i) => ({
            userId: user.id, periodId: period.id, betType: "SIZE" as const,
            betChoice: "BIG", betAmount: 1, contractAmount: 0.98,
            createdAt: new Date(start.getTime() + i),
        })) });
        const started = performance.now();
        const comparison = await prisma.$transaction((tx) => comparePenaltyWager(tx, user.id, user,
            { wager: baseFactor, illegalBetPenaltyFactor: penaltyFactor },
            { hasIllegalBetPenalty: true, illegalBetPenaltyFactor: 9 }));
        const elapsed = performance.now() - started;
        console.info(`Penalty snapshot with 5000 bets: ${Math.round(elapsed)}ms`);
        expect(elapsed).toBeLessThan(5_000);
        expect(comparison.after.totalNeedToBet).toBe(4_000);
    });

    test("penalty application and its history roll back together", async () => {
        const { user } = await fixture();
        const period = await createActiveWingoPeriod(tracker, 300);
        const bets = ["BIG", "SMALL"].map((betChoice) => ({
            id: crypto.randomUUID(), userId: user.id, periodId: period.id, betAmount: 10, betType: "SIZE", betChoice,
        }));
        await expect(prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
            await applyIllegalRoundPenalty(tx, "WINGO", bets);
            throw new Error("rollback test");
        })).rejects.toThrow("rollback test");
        expect(await prisma.penaltyHistoryEvent.count({ where: { userId: user.id } })).toBe(0);
        expect(await prisma.illegalBet.count({ where: { userId: user.id } })).toBe(0);
        expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).hasIllegalBetPenalty).toBe(false);
    });
});
