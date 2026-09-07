import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@bcwin/db";
import { detectSettledIllegalBets, type IllegalBetGame } from "@bcwin/illegal-bets";
import { createWagerRequirement, getUserWagerStatus } from "../../apps/api/src/lib/wagerEngine";
import {
    FixtureTracker, createTestUser, authCookieFor, ensureSystemConfig,
    cleanupByUserIds, createActiveWingoPeriod, post,
} from "../helpers";

describe("Compounding illegal-bet penalty", () => {
    const tracker = new FixtureTracker("compound");
    let base: number;
    beforeAll(async () => {
        base = (await ensureSystemConfig()).illegalBetPenaltyFactor;
    });
    afterAll(async () => {
        await prisma.wagerRequirement.deleteMany({ where: { userId: { in: tracker.userIds } } });
        await cleanupByUserIds(tracker.userIds, { periodPrefix: tracker.periodPrefix });
    });
    async function fixture() {
        const user = await createTestUser(tracker, { balance: 10_000 });
        return { user, cookie: await authCookieFor(user) };
    }
    async function place(cookie: string, periodId: string, choice: string, amount = 10) {
        return post("/api/v1/wingo/bet", { cookie, json: {
            periodId, betType: "COLOR", betChoice: choice, betAmount: amount,
        } });
    }
    async function factor(userId: string) {
        return (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).illegalBetPenaltyFactor;
    }

    test("penalty compounds immediately on three illegal rounds and updates deposit wager", async () => {
        const f = await fixture();
        await createWagerRequirement(prisma, f.user.id, "RECHARGE", 100);
        for (let round = 1; round <= 3; round++) {
            const period = await createActiveWingoPeriod(tracker, 300);
            expect((await place(f.cookie, period.id, "RED")).status).toBe(201);
            expect((await place(f.cookie, period.id, "GREEN")).status).toBe(201);
            expect(await factor(f.user.id)).toBe(base ** round);
            const wager = await getUserWagerStatus(f.user.id);
            expect(wager.depositWagerNeeded).toBe(Math.ceil(100 * base ** round - round * 20));
            const bets = await prisma.wingoBet.findMany({ where: { userId: f.user.id, periodId: period.id } });
            await detectSettledIllegalBets("WINGO", bets);
            expect(await factor(f.user.id)).toBe(base ** round);
        }
    });

    test("additional opposite pairs in one round are recorded without another multiplier", async () => {
        const f = await fixture();
        const period = await createActiveWingoPeriod(tracker, 300);
        for (const choice of ["RED", "GREEN", "RED", "GREEN"]) {
            expect((await place(f.cookie, period.id, choice)).status).toBe(201);
        }
        expect(await factor(f.user.id)).toBe(base);
        expect(await prisma.illegalBet.count({ where: { userId: f.user.id } })).toBe(4);
    });

    test("legal or rejected bets do not add a penalty", async () => {
        const f = await fixture();
        const period = await createActiveWingoPeriod(tracker, 300);
        expect((await place(f.cookie, period.id, "RED", 10)).status).toBe(201);
        expect((await place(f.cookie, period.id, "GREEN", 20)).status).toBe(201);
        expect((await place(f.cookie, period.id, "GREEN", 100_000)).status).toBe(400);
        expect(await factor(f.user.id)).toBeNull();
    });

    test("parallel opposite bets cannot lose or duplicate the penalty", async () => {
        const f = await fixture();
        const period = await createActiveWingoPeriod(tracker, 300);
        const results = await Promise.all([place(f.cookie, period.id, "RED"), place(f.cookie, period.id, "GREEN")]);
        expect(results.map((r) => r.status)).toEqual([201, 201]);
        expect(await factor(f.user.id)).toBe(base);
        const bets = await prisma.wingoBet.findMany({ where: { userId: f.user.id } });
        await Promise.all([detectSettledIllegalBets("WINGO", bets), detectSettledIllegalBets("WINGO", bets)]);
        expect(await factor(f.user.id)).toBe(base);
    });

    test("cross-game offenses multiply the same user penalty; clearing restarts it", async () => {
        const f = await fixture();
        const games: IllegalBetGame[] = ["WINGO", "TRXWINGO", "K3", "MOTO", "5D"];
        for (const [i, game] of games.entries()) {
            const periodId = crypto.randomUUID();
            const choices = game === "5D" ? ["LOW", "HIGH"] : ["BIG", "SMALL"];
            const bets = choices.map((betChoice) => ({
                id: crypto.randomUUID(), userId: f.user.id, periodId, betAmount: 10, betChoice,
            }));
            await detectSettledIllegalBets(game, bets);
            expect(await factor(f.user.id)).toBe(base ** (i + 1));
        }
        const admin = await createTestUser(tracker, { role: "ADMIN" });
        const cleared = await post(`/api/v1/admin/users/${f.user.id}/penalty`, {
            cookie: await authCookieFor(admin), json: { hasIllegalBetPenalty: false },
        });
        expect(cleared.status).toBe(200);
        const period = await createActiveWingoPeriod(tracker, 300);
        await place(f.cookie, period.id, "RED");
        await place(f.cookie, period.id, "GREEN");
        expect(await factor(f.user.id)).toBe(base);
    });
});
