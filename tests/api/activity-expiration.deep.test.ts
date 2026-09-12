import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import { prisma, type ActivityBonusType, type ActivityBonusStatus } from "@bcwin/db";
import { SystemSettings } from "@bcwin/config";
import { checkAndCreateDailyBonuses, checkAndCreateInvitationBonuses, checkAndCreateFirstDepositBonus, expireOldBonuses } from "@bcwin/activity-bonus";
import { authMiddleware } from "../../apps/api/src/middleware/auth";
import { activityClaimRoutes } from "../../apps/api/src/routes/user/activity/claim";
import { activityBonusesRoutes } from "../../apps/api/src/routes/user/activity/bonuses";
import { FixtureTracker, createTestUser, authCookieFor, ensureSystemConfig } from "../helpers/fixtures";

// The migration and expiry sweep affect all matching rows: use a disposable database.
describe.skipIf(process.env.ACTIVITY_EXPIRY_DEEP_TEST !== "1")("Activity expiry: real database lifecycle", () => {
    const tracker = new FixtureTracker("expiry");
    const app = new OpenAPIHono();
    let userId: string;
    let cookie: string;
    let otherCookie: string;
    const past = new Date("2020-01-01T00:00:00Z");
    const selected: ActivityBonusType[] = ["DAILY", "INVITATION", "FIRST_DEPOSIT"];

    beforeAll(async () => {
        const url = new URL(process.env.DATABASE_URL!);
        if (url.pathname !== "/bcwin_expiry_test" || !["localhost", "127.0.0.1"].includes(url.hostname)) {
            throw new Error("Requires disposable local bcwin_expiry_test database");
        }
        await ensureSystemConfig();
        const user = await createTestUser(tracker, { balance: 1000 });
        userId = user.id;
        cookie = await authCookieFor(user);
        otherCookie = await authCookieFor(await createTestUser(tracker));
        app.use("*", authMiddleware);
        activityClaimRoutes(app);
        activityBonusesRoutes(app);
    });
    afterAll(async () => { await prisma.user.deleteMany({ where: { id: { in: tracker.userIds } } }); });

    const claim = (id: string, token = cookie) => app.request("/claim", {
        method: "POST", headers: { "content-type": "application/json", cookie: `auth-token=${token}` },
        body: JSON.stringify({ bonusId: id }),
    });
    const bonus = (type: ActivityBonusType, status: ActivityBonusStatus = "COMPLETED_UNCOLLECTED") =>
        prisma.activityBonus.create({ data: { userId, type, status, amount: 28, expiresAt: past } });

    test("new daily, invite and first-deposit rewards have no deadline and do not duplicate on recheck", async () => {
        const user = await createTestUser(tracker);
        const invited = await createTestUser(tracker, { referredBy: user.referralCode });
        for (const id of [user.id, invited.id]) {
            await prisma.deposit.create({ data: { userId: id, orderId: crypto.randomUUID(), amount: 300, method: "UPI", status: "SUCCESS" } });
        }
        await prisma.inoutBet.create({ data: {
            userId: user.id, token: "test", gameMode: "test", betAmount: 900,
            currency: "INR", operator: "test", transactionId: crypto.randomUUID(), gameId: "test", winAmount: 0,
        } });
        const create = async () => {
            await checkAndCreateDailyBonuses(user.id);
            await checkAndCreateInvitationBonuses(user.id);
            await checkAndCreateFirstDepositBonus(user.id, 300);
        };
        await create();
        const rows = await prisma.activityBonus.findMany({ where: { userId: user.id } });
        expect(rows.length).toBeGreaterThanOrEqual(3);
        for (const type of selected) expect(rows.some(row => row.type === type)).toBe(true);
        for (const row of rows) {
            expect(row.expiresAt).toBeNull();
            expect(row.status).toBe("COMPLETED_UNCOLLECTED");
        }
        await create();
        expect(await prisma.activityBonus.count({ where: { userId: user.id } })).toBe(rows.length);
    });

    test("migration only clears outstanding selected deadlines and is idempotent", async () => {
        const rows = [];
        for (const type of [...selected, "WEEKLY", "ATTENDENCE", "SPIN_WHEEL"] as ActivityBonusType[]) {
            for (const status of ["PENDING", "COMPLETED_UNCOLLECTED", "COLLECTED", "EXPIRED"] as ActivityBonusStatus[]) {
                rows.push(await bonus(type, status));
            }
        }
        const sql = await Bun.file(new URL("../../packages/db/migrations/20260912000000_remove_selected_bonus_expiry/migration.sql", import.meta.url)).text();
        await prisma.$executeRawUnsafe(sql);
        const first = await prisma.activityBonus.findMany({ where: { id: { in: rows.map(row => row.id) } }, orderBy: { id: "asc" } });
        for (const row of first) {
            const clears = selected.includes(row.type) && ["PENDING", "COMPLETED_UNCOLLECTED"].includes(row.status);
            expect(row.expiresAt).toEqual(clears ? null : past);
            expect(row.status).toBe(rows.find(original => original.id === row.id)!.status);
        }
        expect(await prisma.$executeRawUnsafe(sql)).toBe(0);
        expect(await prisma.activityBonus.findMany({ where: { id: { in: rows.map(row => row.id) } }, orderBy: { id: "asc" } })).toEqual(first);
    });

    for (const type of selected) {
        test(`${type}: overdue reward survives scheduler, is listed, credits once and creates wagering`, async () => {
            const row = await bonus(type);
            await expireOldBonuses();
            expect((await prisma.activityBonus.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("COMPLETED_UNCOLLECTED");
            const list = await app.request("/bonuses?status=COMPLETED_UNCOLLECTED&limit=100", { headers: { cookie: `auth-token=${cookie}` } });
            expect(list.status).toBe(200);
            expect((await list.json()).data.some((entry: any) => entry.id === row.id)).toBe(true);
            const balance = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).balance;
            expect((await claim(row.id)).status).toBe(200);
            expect((await claim(row.id)).status).toBe(400);
            expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).balance).toBe(balance + row.amount);
            const updated = await prisma.activityBonus.findUniqueOrThrow({ where: { id: row.id } });
            expect(updated.status).toBe("COLLECTED");
            expect(updated.expiresAt).toBeNull();
            expect(updated.claimAt).not.toBeNull();
            const wagers = await prisma.wagerRequirement.findMany({ where: { sourceId: row.id } });
            expect(wagers.length).toBe(1);
            expect(wagers[0]!.requiredWager).toBe(Math.ceil(row.amount * ((await SystemSettings.get())?.rewardWagerFactor ?? 1)));
        });
    }

    test("weekly and attendance still expire, while ownership and status checks remain enforced", async () => {
        for (const type of ["WEEKLY", "ATTENDENCE"] as const) {
            const row = await bonus(type);
            expect((await claim(row.id)).status).toBe(400);
            expect((await prisma.activityBonus.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("EXPIRED");
            const scheduled = await bonus(type);
            await expireOldBonuses();
            expect((await prisma.activityBonus.findUniqueOrThrow({ where: { id: scheduled.id } })).status).toBe("EXPIRED");
        }
        for (const status of ["PENDING", "COLLECTED", "EXPIRED"] as const) {
            expect((await claim((await bonus("DAILY", status)).id)).status).toBe(400);
        }
        const row = await bonus("DAILY");
        expect((await claim(row.id, otherCookie)).status).toBe(401);
        expect((await claim(row.id, "invalid")).status).toBe(401);
        expect((await claim(crypto.randomUUID())).status).toBe(404);
    });

    test("concurrent claims cannot pay the same non-expiring bonus twice", async () => {
        for (const type of selected) {
            const row = await bonus(type);
            const balance = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).balance;
            const results = await Promise.all(Array.from({ length: 4 }, () => claim(row.id)));
            expect(results.filter(result => result.status === 200).length).toBe(1);
            expect(results.filter(result => result.status === 400).length).toBe(3);
            expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).balance).toBe(balance + row.amount);
            expect(await prisma.wagerRequirement.count({ where: { sourceId: row.id } })).toBe(1);
        }
    });

    test("other reward types remain claimable before expiry or when no deadline exists", async () => {
        for (const type of ["WEEKLY", "ATTENDENCE", "SPIN_WHEEL"] as const) {
            const expiresAt = type === "SPIN_WHEEL" ? null : new Date(Date.now() + 86400000);
            const row = await prisma.activityBonus.create({ data: {
                userId, type, status: "COMPLETED_UNCOLLECTED", amount: 28, expiresAt,
            } });
            expect((await claim(row.id)).status).toBe(200);
            expect((await prisma.activityBonus.findUniqueOrThrow({ where: { id: row.id } })).expiresAt).toEqual(expiresAt);
            expect(await prisma.wagerRequirement.count({ where: { sourceId: row.id } })).toBe(1);
        }
    });

    test("a wagering failure rolls back both the claim and wallet credit, allowing a retry", async () => {
        const row = await bonus("DAILY");
        const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
        const config = spyOn(SystemSettings, "get").mockRejectedValue(new Error("Injected wagering failure"));
        try {
            expect((await claim(row.id)).status).toBe(500);
        } finally {
            config.mockRestore();
        }
        expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).balance).toBe(before.balance);
        expect(await prisma.activityBonus.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
        expect(await prisma.wagerRequirement.count({ where: { sourceId: row.id } })).toBe(0);
        expect((await claim(row.id)).status).toBe(200);
    });
});
