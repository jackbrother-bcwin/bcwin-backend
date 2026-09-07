import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@bcwin/db";
import { detectSettledIllegalBets } from "@bcwin/illegal-bets";
import {
    FixtureTracker, createTestUser, authCookieFor, ensureSystemConfig,
    cleanupByUserIds, createActiveWingoPeriod, createActiveFiveDPeriod,
    createActiveMotoPeriod, createActiveK3Period, post,
} from "../helpers";

describe("Cross-market illegal bet placement", () => {
    const tracker = new FixtureTracker("crossbet");
    let base: number;
    beforeAll(async () => { base = (await ensureSystemConfig()).illegalBetPenaltyFactor; });
    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, { periodPrefix: tracker.periodPrefix });
    });
    async function fixture() {
        const user = await createTestUser(tracker, { balance: 10_000 });
        return { user, cookie: await authCookieFor(user) };
    }
    async function factor(userId: string) {
        return (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).illegalBetPenaltyFactor;
    }
    async function place(game: string, cookie: string, periodId: string, body: Record<string, unknown>) {
        const response = await post(`/api/v1/${game}/bet`, { cookie, json: { periodId, betAmount: 100, ...body } });
        expect(response.status).toBe(201);
    }
    test("Wingo same-color number allowed; opposite-color number penalized immediately and only once", async () => {
        const f = await fixture();
        const period = await createActiveWingoPeriod(tracker, 300);
        await place("wingo", f.cookie, period.id, { betType: "NUMBER", betChoice: "2" });
        await place("wingo", f.cookie, period.id, { betType: "COLOR", betChoice: "RED" });
        expect(await factor(f.user.id)).toBeNull();
        await place("wingo", f.cookie, period.id, { betType: "NUMBER", betChoice: "3", betAmount: 40 });
        expect(await factor(f.user.id)).toBe(base);
        const bets = await prisma.wingoBet.findMany({ where: { userId: f.user.id } });
        await detectSettledIllegalBets("WINGO", bets);
        expect(await factor(f.user.id)).toBe(base);
        expect(await prisma.illegalBet.count({ where: { userId: f.user.id } })).toBe(1);
    });
    test("5D scopes are loaded for placement and settlement", async () => {
        const f = await fixture();
        const period = await createActiveFiveDPeriod(tracker, 300);
        await place("5d", f.cookie, period.id, { betCategory: "POSITION", position: "A", betType: "EXACT_NUMBER", betChoice: "2" });
        await place("5d", f.cookie, period.id, { betCategory: "POSITION", position: "B", betType: "HIGH", betChoice: "HIGH" });
        expect(await factor(f.user.id)).toBeNull();
        await place("5d", f.cookie, period.id, { betCategory: "POSITION", position: "A", betType: "HIGH", betChoice: "HIGH", betAmount: 40 });
        expect(await factor(f.user.id)).toBe(base);
        await detectSettledIllegalBets("5D", await prisma.fiveDBet.findMany({ where: { userId: f.user.id } }));
        expect(await factor(f.user.id)).toBe(base);
    });
    test("Moto lowercase selections and finishing places are respected", async () => {
        const f = await fixture();
        const period = await createActiveMotoPeriod(tracker, 300);
        await place("moto", f.cookie, period.id, { targetPosition: "FIRST", betType: "POSITION", betChoice: "5" });
        await place("moto", f.cookie, period.id, { targetPosition: "SECOND", betType: "BIG_SMALL", betChoice: "big" });
        expect(await factor(f.user.id)).toBeNull();
        await place("moto", f.cookie, period.id, { targetPosition: "FIRST", betType: "BIG_SMALL", betChoice: "big", betAmount: 40 });
        expect(await factor(f.user.id)).toBe(base);
    });
    test("K3 SUM is compared with opposing sum parity", async () => {
        const f = await fixture();
        const period = await createActiveK3Period(tracker, 300);
        await place("k3", f.cookie, period.id, { betType: "SUM", betChoice: "10" });
        await place("k3", f.cookie, period.id, { betType: "EVEN", betChoice: "EVEN" });
        expect(await factor(f.user.id)).toBeNull();
        await place("k3", f.cookie, period.id, { betType: "ODD", betChoice: "ODD", betAmount: 40 });
        expect(await factor(f.user.id)).toBe(base);
    });
    test("covering all ten Wingo numbers produces one penalty and survives retries", async () => {
        const f = await fixture();
        const period = await createActiveWingoPeriod(tracker, 300);
        for (let n = 0; n <= 9; n++) {
            await place("wingo", f.cookie, period.id, { betType: "NUMBER", betChoice: String(n) });
            expect(await factor(f.user.id)).toBe(n === 9 ? base : null);
        }
        await detectSettledIllegalBets("WINGO", await prisma.wingoBet.findMany({ where: { userId: f.user.id } }));
        expect(await factor(f.user.id)).toBe(base);
        expect(await prisma.illegalBet.count({ where: { userId: f.user.id } })).toBe(1);
    });
});
