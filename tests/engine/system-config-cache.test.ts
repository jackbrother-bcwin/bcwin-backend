import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import Redis from "ioredis";
import { OpenAPIHono } from "@hono/zod-openapi";
import { Cache, CacheKey, SystemConfigCache } from "@bcwin/cache";
import { SystemSettings } from "@bcwin/config";
import { prisma } from "@bcwin/db";
import { systemConfigRoutes } from "../../apps/api/src/routes/admin/config/config";
import { AUTH_COOKIE_NAME } from "../../apps/api/src/lib/auth";

// Must point to disposable Redis: these tests use the actual system config keys.
// TEST_REDIS_URL=redis://127.0.0.1:16379 bun test --env-file .env tests/engine/system-config-cache.test.ts
describe.skipIf(!process.env.TEST_REDIS_URL)("System config cache (isolated Redis)", () => {
    let client: Redis;
    let originalClient: Redis;
    let disabled: string | undefined;
    const restores: Array<() => void> = [];

    function mockDelegate(delegate: any, method: string) {
        const original = delegate[method];
        const replacement = mock();
        delegate[method] = replacement;
        restores.push(() => { delegate[method] = original; });
        return replacement;
    }

    beforeAll(async () => {
        client = new Redis(process.env.TEST_REDIS_URL!, { lazyConnect: true });
        await client.connect();
    });
    beforeEach(async () => {
        originalClient = Cache.client;
        Cache.client = client;
        disabled = process.env.DISABLE_CACHE;
        delete process.env.DISABLE_CACHE;
        await client.del(CacheKey.systemConfig, CacheKey.systemConfigRevision);
    });
    afterEach(async () => {
        for (const restore of restores.reverse()) restore();
        restores.length = 0;
        await client.del(CacheKey.systemConfig, CacheKey.systemConfigRevision);
        Cache.client = originalClient;
        if (disabled === undefined) delete process.env.DISABLE_CACHE;
        else process.env.DISABLE_CACHE = disabled;
    });
    afterAll(async () => { await client.quit(); });

    test("repeated algorithm reads use Redis and config expires within a minute", async () => {
        const load = mockDelegate(prisma.config, "findFirst")
            .mockResolvedValue({ wingoAlgorithm: "WINNING" });
        expect(await SystemSettings.getWingoAlgorithm()).toBe("WINNING");
        expect(await SystemSettings.getWingoAlgorithm()).toBe("WINNING");
        expect(load).toHaveBeenCalledTimes(1);
        const ttl = await client.ttl(CacheKey.systemConfig);
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(60);
    });

    test("a slow cache miss cannot overwrite or return an older config after refresh", async () => {
        const entered = Promise.withResolvers<void>();
        const pending = Promise.withResolvers<{ wingoAlgorithm: string }>();
        const load = mock(async () => {
            entered.resolve();
            return pending.promise;
        });
        const oldRead = SystemConfigCache.getOrLoad(load);
        await entered.promise;

        await SystemConfigCache.invalidate();
        await SystemConfigCache.getOrLoad(async () => ({ wingoAlgorithm: "TRX" }), true);
        pending.resolve({ wingoAlgorithm: "RANDOM" });

        expect(await oldRead).toEqual({ wingoAlgorithm: "TRX" });
        expect(JSON.parse((await client.get(CacheKey.systemConfig))!).wingoAlgorithm).toBe("TRX");
    });

    test("invalidation fences a read that started during an admin DB update", async () => {
        await SystemConfigCache.invalidate(); // Before admin commits.
        const entered = Promise.withResolvers<void>();
        const pending = Promise.withResolvers<{ wingoAlgorithm: string }>();
        const load = mock(async () => ({ wingoAlgorithm: "WINNING" }))
            .mockImplementationOnce(() => { entered.resolve(); return pending.promise; });
        const reading = SystemConfigCache.getOrLoad(load);
        await entered.promise;
        await SystemConfigCache.invalidate(); // After admin commits.
        pending.resolve({ wingoAlgorithm: "RANDOM" });

        expect(await reading).toEqual({ wingoAlgorithm: "WINNING" });
        expect(load).toHaveBeenCalledTimes(2);
    });

    function adminApp() {
        let config = {
            id: "test-config", wingoAlgorithm: "RANDOM", upiIds: [],
            createdAt: new Date(), updatedAt: new Date(),
        };
        const read = mockDelegate(prisma.config, "findFirst")
            .mockImplementation(async () => ({ ...config }));
        const update = mockDelegate(prisma.config, "update")
            .mockImplementation(async ({ data }: any) => {
                config = { ...config, ...data, updatedAt: new Date() };
                return { ...config };
            });
        const app = new OpenAPIHono();
        systemConfigRoutes(app);
        return { app, read, update };
    }

    function patch(app: OpenAPIHono, wingoAlgorithm: string) {
        return app.request("/", {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                Cookie: `${AUTH_COOKIE_NAME}=test-admin`,
            },
            body: JSON.stringify({ wingoAlgorithm }),
        });
    }

    test("admin PATCH refreshes Redis before success and the next draw needs no config DB read", async () => {
        const { app, read, update } = adminApp();
        expect(await SystemSettings.getWingoAlgorithm()).toBe("RANDOM");
        const response = await patch(app, "WINNING");
        expect(response.status).toBe(200);
        expect((await response.json()).success).toBe(true);
        expect(update).toHaveBeenCalledTimes(1);
        const readsBeforeDraw = read.mock.calls.length;
        expect(await SystemSettings.getWingoAlgorithm()).toBe("WINNING");
        expect(read).toHaveBeenCalledTimes(readsBeforeDraw);
    });

    test("admin PATCH fails before the DB write when invalidation cannot be confirmed", async () => {
        const { app, update } = adminApp();
        const failing = spyOn(SystemConfigCache, "invalidate").mockRejectedValue(new Error("Redis unavailable"));
        restores.push(() => failing.mockRestore());
        expect((await patch(app, "TRX")).status).toBe(500);
        expect(update).not.toHaveBeenCalled();
    });

    test("admin PATCH does not report success if its post-commit cache fill fails", async () => {
        const { app, update } = adminApp();
        await SystemSettings.getWingoAlgorithm();
        const failing = spyOn(SystemConfigCache, "getOrLoad").mockRejectedValue(new Error("Redis write failed"));
        restores.push(() => failing.mockRestore());
        expect((await patch(app, "TRX")).status).toBe(500);
        expect(update).toHaveBeenCalledTimes(1);
        expect(await client.get(CacheKey.systemConfig)).toBeNull();
    });

    test("invalidation retries transient Redis failures", async () => {
        const original = client.eval.bind(client);
        const failing = spyOn(client, "eval")
            .mockImplementationOnce(() => Promise.reject(new Error("Transient Redis failure")))
            .mockImplementation(original);
        restores.push(() => failing.mockRestore());
        await client.set(CacheKey.systemConfig, JSON.stringify({ wingoAlgorithm: "RANDOM" }));
        await SystemConfigCache.invalidate();
        expect(failing).toHaveBeenCalledTimes(2);
        expect(await client.get(CacheKey.systemConfig)).toBeNull();
    });

    test("Redis read failures fall back to the database", async () => {
        const load = mockDelegate(prisma.config, "findFirst")
            .mockResolvedValue({ wingoAlgorithm: "TRX" });
        const failing = spyOn(client, "eval").mockRejectedValue(new Error("Redis unavailable"));
        restores.push(() => failing.mockRestore());
        expect(await SystemSettings.getWingoAlgorithm()).toBe("TRX");
        expect(load).toHaveBeenCalledTimes(1);
    });

    test("admin refresh still updates Redis when caching is disabled in the API process", async () => {
        process.env.DISABLE_CACHE = "1";
        mockDelegate(prisma.config, "findFirst")
            .mockResolvedValue({ wingoAlgorithm: "WINNING" });
        await SystemSettings.refresh();
        expect(JSON.parse((await client.get(CacheKey.systemConfig))!).wingoAlgorithm).toBe("WINNING");
    });
});
