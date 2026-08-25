/**
 * Game history paginates in SQL (ADR-0044). Same merge order, no full dump.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@bcwin/db";
import { Cache } from "@bcwin/cache";
import {
    FixtureTracker,
    authCookieFor,
    cleanupByUserIds,
    createActiveK3Period,
    createActiveWingoPeriod,
    createTestUser,
    ensureSystemConfig,
    get,
} from "../helpers";

describe("Game history SQL pagination (ADR-0044)", () => {
    const tracker = new FixtureTracker("ghp");
    let userId: string;
    let cookie: string;
    const idsNewestFirst: string[] = [];

    beforeAll(async () => {
        await ensureSystemConfig();
        const user = await createTestUser(tracker, { balance: 10_000 });
        userId = user.id;
        cookie = await authCookieFor(user);
        const wingo = await createActiveWingoPeriod(tracker, 60);
        const k3 = await createActiveK3Period(tracker, 60);
        const t0 = Date.now() - 60_000;
        for (let i = 0; i < 3; i++) {
            const w = await prisma.wingoBet.create({
                data: {
                    userId,
                    periodId: wingo.id,
                    betAmount: 10 + i,
                    contractAmount: 9.8,
                    betType: "COLOR",
                    betChoice: "RED",
                    createdAt: new Date(t0 + i * 4_000),
                },
            });
            const k = await prisma.k3Bet.create({
                data: {
                    userId,
                    periodId: k3.id,
                    betAmount: 20 + i,
                    contractAmount: 19.6,
                    betType: "BIG",
                    betChoice: "BIG",
                    createdAt: new Date(t0 + i * 4_000 + 2_000),
                },
            });
            idsNewestFirst.unshift(k.id, w.id);
        }
        // unshift per pair: last pair is newest. Order should be
        // k2, w2, k1, w1, k0, w0
        await Cache.invalidateUserGameCaches(userId);
    });

    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
            giftCodePrefix: tracker.giftPrefix,
            orderIdPrefix: tracker.orderPrefix,
        });
    });

    test("page 1 is the newest merged bets; page 2 does not overlap", async () => {
        const p1 = await get("/api/v1/user/game-history", {
            cookie,
            query: { page: 1, limit: 2 },
        });
        const p2 = await get("/api/v1/user/game-history", {
            cookie,
            query: { page: 2, limit: 2 },
        });
        expect(p1.status).toBe(200);
        expect(p2.status).toBe(200);
        expect(p1.json?.total).toBe(6);
        expect(p1.json?.totalPages).toBe(3);
        const ids1 = (p1.json?.data ?? []).map((r: { id: string }) => r.id);
        const ids2 = (p2.json?.data ?? []).map((r: { id: string }) => r.id);
        expect(ids1).toEqual(idsNewestFirst.slice(0, 2));
        expect(ids2).toEqual(idsNewestFirst.slice(2, 4));
        expect(ids1.some((id: string) => ids2.includes(id))).toBe(false);
    });

    test("majorGameType=WINGO only counts wingo rows", async () => {
        const res = await get("/api/v1/user/game-history", {
            cookie,
            query: { page: 1, limit: 20, majorGameType: "WINGO" },
        });
        expect(res.status).toBe(200);
        expect(res.json?.total).toBe(3);
        expect(
            (res.json?.data ?? []).every(
                (r: { majorGameType: string }) => r.majorGameType === "WINGO"
            )
        ).toBe(true);
    });
});
