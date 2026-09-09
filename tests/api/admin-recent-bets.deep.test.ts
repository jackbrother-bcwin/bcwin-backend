import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@bcwin/db";
import { Cache } from "@bcwin/cache";
import {
    FixtureTracker, authCookieFor, cleanupByUserIds, createTestUser,
    createActiveWingoPeriod, createActiveTrxWingoPeriod, ensureSystemConfig, get,
} from "../helpers";

describe("Admin latest 100 settled bets", () => {
    const tracker = new FixtureTracker("recent100");
    let adminCookie: string;
    let userCookie: string;
    const expectedIds: Record<string, string[]> = {};

    beforeAll(async () => {
        await ensureSystemConfig();
        const admin = await createTestUser(tracker, { role: "ADMIN" });
        const user = await createTestUser(tracker);
        const demo = await createTestUser(tracker);
        await prisma.user.update({ where: { id: demo.id }, data: { isDemo: true } });
        adminCookie = await authCookieFor(admin);
        userCookie = await authCookieFor(user);

        for (const game of ["wingo", "trx"] as const) {
            const period = game === "wingo"
                ? await createActiveWingoPeriod(tracker, 300)
                : await createActiveTrxWingoPeriod(tracker, 300);
            const base = Date.UTC(2090, 0, 1);
            const bets = Array.from({ length: 108 }, (_, i) => ({
                id: crypto.randomUUID(),
                userId: i === 105 ? demo.id : i === 106 ? admin.id : user.id,
                periodId: period.id,
                betType: "NUMBER" as const,
                betChoice: "3",
                betAmount: 100,
                contractAmount: 98,
                status: i === 107 ? "PENDING" as const : i % 2 ? "WON" as const : "LOST" as const,
            }));
            const results = bets.slice(0, 107).map((bet, i) => ({
                id: `${tracker.runId}-${game}-${String(i).padStart(3, "0")}`,
                betId: bet.id,
                periodId: period.id,
                isWin: i % 2 === 1,
                winAmount: i % 2 ? 882 : 0,
                // Pairs share settlement times to exercise deterministic ordering.
                processedAt: new Date(base + Math.floor(i / 2) * 1_000),
            }));
            if (game === "wingo") {
                await prisma.wingoBet.createMany({ data: bets });
                await prisma.wingoBetResult.createMany({ data: results });
            } else {
                await prisma.trxWingoBet.createMany({ data: bets });
                await prisma.trxWingoBetResult.createMany({ data: results });
            }
            expectedIds[game] = bets.slice(5, 105).reverse().map((bet) => bet.id);
            await Cache.del(`admin:recent-${game}:v2`);
        }
    });

    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, { periodPrefix: tracker.periodPrefix });
        await Cache.del("admin:recent-wingo:v2");
        await Cache.del("admin:recent-trx:v2");
    });

    for (const game of ["wingo", "trx"]) {
        test(`${game}: latest 100, stable order, real players and settled bets only`, async () => {
            const url = `/api/v1/admin/dashboard/${game}-bets`;
            const response = await get(url, { cookie: adminCookie });
            expect(response.status).toBe(200);
            expect(response.json.bets.map((bet: { id: string }) => bet.id)).toEqual(expectedIds[game]);
            expect(response.json.bets[0].winAmount).toBe(0);
            expect(response.json.bets[1].winAmount).toBe(882);
            const cached = await get(url, { cookie: adminCookie });
            expect(cached.json).toEqual(response.json);
            expect((await get(url, { cookie: userCookie })).status).toBe(401);
        });
    }
});
