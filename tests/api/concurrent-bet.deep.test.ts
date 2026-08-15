/**
 * Deep: concurrent place-bet cannot overdraw; atomic debit under auth cache.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "@bcwin/db";
import {
    post,
    FixtureTracker,
    createTestUser,
    authCookieFor,
    cleanupByUserIds,
    ensureSystemConfig,
    createActiveWingoPeriod,
} from "../helpers";
import { Cache, CacheKey } from "@bcwin/cache";

describe("Deep: concurrent bet debit", () => {
    const tracker = new FixtureTracker("race");
    let cookie: string;
    let userId: string;

    beforeAll(async () => {
        await ensureSystemConfig();
        const user = await createTestUser(tracker, { balance: 100 });
        userId = user.id;
        cookie = await authCookieFor(user);
        await Cache.invalidateUserGameCaches(userId);
    });

    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
        });
    });

    test("parallel 10×50 bets only succeed while balance holds", async () => {
        const period = await createActiveWingoPeriod(tracker, 300);

        const results = await Promise.all(
            Array.from({ length: 10 }, () =>
                post("/api/v1/wingo/bet", {
                    cookie,
                    json: {
                        periodId: period.id,
                        betType: "COLOR",
                        betChoice: "RED",
                        betAmount: 50,
                    },
                })
            )
        );

        const ok = results.filter((r) => r.status === 201);
        const bad = results.filter((r) => r.status === 400);

        // 100 balance / 50 = max 2 successful bets
        expect(ok.length).toBeLessThanOrEqual(2);
        expect(ok.length).toBeGreaterThanOrEqual(1);
        expect(bad.length).toBeGreaterThanOrEqual(8);

        const user = await prisma.user.findUniqueOrThrow({
            where: { id: userId },
        });
        expect(user.balance).toBeGreaterThanOrEqual(0);
        expect(user.balance).toBeLessThanOrEqual(50);

        const pendingBets = await prisma.wingoBet.count({
            where: { userId, periodId: period.id },
        });
        expect(pendingBets).toBe(ok.length);
    });
});
