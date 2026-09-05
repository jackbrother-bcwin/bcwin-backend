/**
 * Admin can change the Win Go number until 3s remain.
 * Bet lock stays 5s/10s; the hidden draw waits for that freeze.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@bcwin/db";
import { ResultSetter } from "@bcwin/cache";
import { ResultGenerator } from "../../apps/engine/src/services/wingo/resultGenerator";
import {
    FixtureTracker,
    authCookieFor,
    cleanupByUserIds,
    createTestUser,
    createWingoPeriod,
    ensureSystemConfig,
    post,
} from "../helpers";

describe("Admin Win Go result freeze at 3s", () => {
    const tracker = new FixtureTracker("wgfreeze");
    const results = new ResultGenerator();
    let cookie: string;

    beforeAll(async () => {
        await ensureSystemConfig();
        cookie = await authCookieFor(
            await createTestUser(tracker, { role: "ADMIN" })
        );
    });

    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
        });
    });

    test("admin can set and overwrite until 3s remaining, then the draw uses it", async () => {
        const now = Date.now();
        const period = await createWingoPeriod(tracker, {
            durationSeconds: 30,
            startTime: new Date(now - 25_000),
            endTime: new Date(now + 4_500),
            suffix: "open",
        });

        const first = await post("/api/v1/admin/setResults", {
            cookie,
            json: {
                game: "wingo",
                periodId: period.id,
                result: { number: 1 },
            },
        });
        expect(first.status).toBe(200);
        expect(first.json?.success).toBe(true);

        const second = await post("/api/v1/admin/setResults", {
            cookie,
            json: {
                game: "wingo",
                periodId: period.id,
                result: { number: 8 },
            },
        });
        expect(second.status).toBe(200);

        const drawn = await results.processPeriodResult(period.id, {
            publish: false,
        });
        expect(drawn).toEqual({ number: 8, color: "RED", size: "BIG" });
        expect(
            (await prisma.wingoPeriod.findUniqueOrThrow({ where: { id: period.id } }))
                .resultNumber
        ).toBe(8);
        expect(await ResultSetter.get("wingo", period.id)).toBeNull();
    });

    test("admin set is rejected once 3s remain, even if Redis is empty", async () => {
        const now = Date.now();
        const period = await createWingoPeriod(tracker, {
            durationSeconds: 30,
            startTime: new Date(now - 27_500),
            endTime: new Date(now + 2_500),
            suffix: "frozen",
        });

        const res = await post("/api/v1/admin/setResults", {
            cookie,
            json: {
                game: "wingo",
                periodId: period.id,
                result: { number: 7 },
            },
        });
        expect(res.status).toBe(400);
        expect(res.json?.error).toBe("Result is frozen for this period");
        expect(await ResultSetter.get("wingo", period.id)).toBeNull();
    });

    test("admin set is rejected after the number is already stored", async () => {
        const now = Date.now();
        const period = await createWingoPeriod(tracker, {
            durationSeconds: 30,
            startTime: new Date(now - 20_000),
            endTime: new Date(now + 8_000),
            resultNumber: 4,
            resultColor: "RED",
            resultSize: "SMALL",
            suffix: "stored",
        });

        const res = await post("/api/v1/admin/setResults", {
            cookie,
            json: {
                game: "wingo",
                periodId: period.id,
                result: { number: 9 },
            },
        });
        expect(res.status).toBe(400);
        expect(res.json?.error).toBe("Result is frozen for this period");
        expect(
            (await prisma.wingoPeriod.findUniqueOrThrow({ where: { id: period.id } }))
                .resultNumber
        ).toBe(4);
    });
});
