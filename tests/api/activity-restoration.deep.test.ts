import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import { prisma, type ActivityBonusType, type ActivityBonusStatus } from "@bcwin/db";
import { WebSocketManager } from "@bcwin/websocket";
import { SystemSettings } from "@bcwin/config";
import { expireOldBonuses } from "@bcwin/activity-bonus";
import { authMiddleware } from "../../apps/api/src/middleware/auth";
import { activityClaimRoutes } from "../../apps/api/src/routes/user/activity/claim";
import { activityBonusesRoutes } from "../../apps/api/src/routes/user/activity/bonuses";
import { FixtureTracker, createTestUser, authCookieFor, ensureSystemConfig } from "../helpers/fixtures";

// This data migration scans all matching rewards, so never use a shared database.
describe.skipIf(process.env.ACTIVITY_EXPIRY_DEEP_TEST !== "1")("Restore expired activity rewards", () => {
    const tracker = new FixtureTracker("restorebonus");
    const app = new OpenAPIHono();
    const selected: ActivityBonusType[] = ["DAILY", "INVITATION", "FIRST_DEPOSIT"];
    const oldDate = new Date("2020-01-01T00:00:00Z");
    let userId: string;
    let cookie: string;
    let migration: string;
    let publish: ReturnType<typeof spyOn>;
    let restoreConfig = () => {};

    beforeAll(async () => {
        const url = new URL(process.env.DATABASE_URL!);
        if (url.pathname !== "/bcwin_expiry_test" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Disposable local bcwin_expiry_test required");
        const config = await ensureSystemConfig();
        const settings = spyOn(SystemSettings, "get").mockResolvedValue(config);
        restoreConfig = () => settings.mockRestore();
        const user = await createTestUser(tracker, { balance: 1000 });
        userId = user.id;
        cookie = await authCookieFor(user);
        migration = await Bun.file(new URL("../../packages/db/migrations/20260913000000_restore_expired_activity_rewards/migration.sql", import.meta.url)).text();
        publish = spyOn(WebSocketManager, "publishToUser").mockImplementation(async () => {});
        app.use("*", authMiddleware);
        activityClaimRoutes(app);
        activityBonusesRoutes(app);
    });
    afterAll(async () => {
        publish?.mockRestore();
        restoreConfig();
        await prisma.user.deleteMany({ where: { id: { in: tracker.userIds } } });
    });
    const create = (type: ActivityBonusType, status: ActivityBonusStatus, claimAt: Date | null = null) => prisma.activityBonus.create({ data: {
        userId, type, status, amount: 28, expiresAt: oldDate, claimAt,
        createdAt: oldDate, metadata: { tier: 0, achieved: 300 },
    } });
    const claim = (bonusId: string) => app.request("/claim", {
        method: "POST", headers: { cookie: `auth-token=${cookie}`, "content-type": "application/json" },
        body: JSON.stringify({ bonusId }),
    });

    test("migration restores only eligible expired types, preserves history and balances, and is idempotent", async () => {
        const rows = [];
        const skipIds = new Set<string>();
        for (const type of [...selected, "WEEKLY", "ATTENDENCE", "SPIN_WHEEL"] as ActivityBonusType[]) {
            for (const status of ["PENDING", "COMPLETED_UNCOLLECTED", "COLLECTED", "EXPIRED"] as ActivityBonusStatus[]) rows.push(await create(type, status));
        }
        for (const type of selected) {
            const claimed = await create(type, "EXPIRED", oldDate);
            rows.push(claimed);
            skipIds.add(claimed.id);
            for (const isCleared of [false, true]) {
                const paid = await create(type, "EXPIRED");
                rows.push(paid);
                skipIds.add(paid.id);
                await prisma.wagerRequirement.create({ data: {
                    userId, sourceType: "REWARD", sourceId: paid.id, amount: 28,
                    requiredWager: 28, isCleared, wagerCleared: isCleared ? 28 : 0,
                } });
            }
        }
        const wallet = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
        const wagers = await prisma.wagerRequirement.findMany({ where: { userId }, orderBy: { id: "asc" } });
        expect(await prisma.$executeRawUnsafe(migration)).toBe(3);
        for (const original of rows) {
            const updated = await prisma.activityBonus.findUniqueOrThrow({ where: { id: original.id } });
            const restored = selected.includes(original.type) && original.status === "EXPIRED" && !skipIds.has(original.id);
            expect(updated).toEqual(restored ? {
                ...original, status: "COMPLETED_UNCOLLECTED", expiresAt: null, updatedAt: expect.any(Date),
            } : original);
        }
        expect(await prisma.user.findUniqueOrThrow({ where: { id: userId } })).toEqual(wallet);
        expect(await prisma.wagerRequirement.findMany({ where: { userId }, orderBy: { id: "asc" } })).toEqual(wagers);
        expect(await prisma.$executeRawUnsafe(migration)).toBe(0);
    });

    for (const type of selected) {
        test(`${type}: restored reward is listed, survives expiry checks and can be paid only once`, async () => {
            const original = await create(type, "EXPIRED");
            expect((await claim(original.id)).status).toBe(400);
            expect(await prisma.$executeRawUnsafe(migration)).toBe(1);
            await expireOldBonuses();
            const list = await app.request("/bonuses?status=COMPLETED_UNCOLLECTED&limit=100", { headers: { cookie: `auth-token=${cookie}` } });
            expect(list.status).toBe(200);
            expect((await list.json()).data.some((row: { id: string }) => row.id === original.id)).toBe(true);
            const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
            expect((await claim(original.id)).status).toBe(200);
            expect((await claim(original.id)).status).toBe(400);
            expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).balance).toBe(before.balance + original.amount);
            const updated = await prisma.activityBonus.findUniqueOrThrow({ where: { id: original.id } });
            expect(updated.status).toBe("COLLECTED");
            expect(updated.expiresAt).toBeNull();
            expect(updated.claimAt).not.toBeNull();
            expect(updated.createdAt).toEqual(original.createdAt);
            expect(updated.metadata).toEqual(original.metadata);
            expect(await prisma.wagerRequirement.count({ where: { userId, sourceType: "REWARD", sourceId: original.id } })).toBe(1);
            expect(await prisma.$executeRawUnsafe(migration)).toBe(0);
        });
    }
});
