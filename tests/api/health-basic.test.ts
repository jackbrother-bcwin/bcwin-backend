import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "@bcwin/db";
import { get, FixtureTracker, cleanupByUserIds, ensureSystemConfig } from "../helpers";

describe("API: basic / health", () => {
    const tracker = new FixtureTracker("health");

    beforeAll(async () => {
        await ensureSystemConfig();
        await prisma.$connect();
    });

    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
        });
    });

    test("GET /api/v1/health returns ok with db + cache", async () => {
        const res = await get("/api/v1/health");
        expect(res.status).toBe(200);
        expect(res.json?.status).toBe("ok");
        expect(res.json?.services?.api?.status).toBe("healthy");
        expect(res.json?.services?.database?.status).toBe("healthy");
        expect(res.json?.services?.cache?.status).toBe("healthy");
    });

    test("OpenAPI doc is available", async () => {
        const res = await get("/doc");
        expect(res.status).toBe(200);
        expect(res.json?.openapi || res.text.includes("openapi")).toBeTruthy();
    });
});
