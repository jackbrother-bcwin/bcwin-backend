import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import { prisma, type PaymentOrderStatus } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import { WebSocketManager } from "@bcwin/websocket";
import { checkAndCreateInvitationBonuses, checkAndCreateReferrerInvitationBonuses } from "@bcwin/activity-bonus";
import { authMiddleware } from "../../apps/api/src/middleware/auth";
import { activityProgressRoutes } from "../../apps/api/src/routes/user/activity/progress";
import { activityBonusesRoutes } from "../../apps/api/src/routes/user/activity/bonuses";
import { activityClaimRoutes } from "../../apps/api/src/routes/user/activity/claim";
import { cxpayCallbackRoutes } from "../../apps/api/src/routes/callback/payment/cxpay";
import { xdpayCallbackRoutes } from "../../apps/api/src/routes/callback/payment/xdpay";
import { oxapayCallbackRoutes } from "../../apps/api/src/routes/callback/payment/oxapay";
import { depositRoutes } from "../../apps/api/src/routes/admin/transactions/deposit";
import { paymentRoutes } from "../../apps/api/src/routes/payment/payment";
import { Cxpay, Xdpay, Oxapay } from "../../apps/api/src/lib/payment";
import { FixtureTracker, createTestUser, authCookieFor, ensureSystemConfig } from "../helpers/fixtures";

// Run alongside activity-expiration.deep.test.ts on its disposable database.
describe.skipIf(process.env.ACTIVITY_EXPIRY_DEEP_TEST !== "1")("Instant invitation rewards", () => {
    const tracker = new FixtureTracker("instantinvite");
    const app = new OpenAPIHono();
    const callbacks = new OpenAPIHono();
    const sockets: string[] = [];
    beforeAll(async () => {
        const url = new URL(process.env.DATABASE_URL!);
        if (url.pathname !== "/bcwin_expiry_test" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Disposable local bcwin_expiry_test required");
        await ensureSystemConfig();
        app.use("*", authMiddleware);
        activityProgressRoutes(app);
        activityBonusesRoutes(app);
        activityClaimRoutes(app);
        cxpayCallbackRoutes(callbacks);
        xdpayCallbackRoutes(callbacks);
        oxapayCallbackRoutes(callbacks);
    });
    afterAll(async () => {
        for (const id of sockets) await WebSocketManager.removeClient(id);
        await prisma.user.deleteMany({ where: { id: { in: tracker.userIds } } });
    });
    const deposit = (userId: string, amount: number, status: PaymentOrderStatus = "SUCCESS", method = "UPI") =>
        prisma.deposit.create({ data: { userId, amount, status, method, orderId: crypto.randomUUID() } });
    const invitationRows = (userId: string) => prisma.activityBonus.findMany({ where: { userId, type: "INVITATION" }, orderBy: { amount: "asc" } });
    const request = async (path: string, user: Parameters<typeof authCookieFor>[0], body?: object) => app.request(path, {
        method: body ? "POST" : "GET", headers: { cookie: `auth-token=${await authCookieFor(user)}`, "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });

    test("claim tier 1, qualify for tier 2 seconds later, then claim immediately without a scheduler", async () => {
        const user = await createTestUser(tracker, { balance: 1000 });
        const first = await createTestUser(tracker, { referredBy: user.referralCode });
        const second = await createTestUser(tracker, { referredBy: user.referralCode });
        const third = await createTestUser(tracker, { referredBy: user.referralCode });
        await deposit(first.id, 200);
        await checkAndCreateReferrerInvitationBonuses(first.id);
        const [tier1] = await invitationRows(user.id);
        expect(tier1!.amount).toBe(27);
        expect((await request("/claim", user, { bonusId: tier1!.id })).status).toBe(200);
        await deposit(first.id, 100); // cumulative deposits count
        await deposit(second.id, 300);
        await deposit(third.id, 300);
        await checkAndCreateReferrerInvitationBonuses(third.id);
        const progress = await request("/progress", user);
        expect(progress.status).toBe(200);
        const tiers = (await progress.json()).data.invitation;
        expect(tiers[0].claimed).toBe(true);
        expect(tiers[1].completed).toBe(true);
        expect(tiers[1].bonusId).toBeTruthy();
        expect((await request("/claim", user, { bonusId: tiers[1].bonusId })).status).toBe(200);
        expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).balance).toBe(1184);
        const rows = await invitationRows(user.id);
        expect(rows.length).toBe(2);
        expect(rows.every(row => row.status === "COLLECTED" && row.expiresAt === null)).toBe(true);
        expect(rows[1]!.claimAt!.getTime() - rows[0]!.claimAt!.getTime()).toBeLessThan(5 * 60 * 1000);
        expect(await prisma.wagerRequirement.count({ where: { userId: user.id, sourceType: "REWARD" } })).toBe(2);
    });

    test("page and claimable-list reads recover rewards if a deposit notification was missed", async () => {
        for (const path of ["/progress", "/bonuses?status=COMPLETED_UNCOLLECTED&type=INVITATION"]) {
            const user = await createTestUser(tracker);
            const child = await createTestUser(tracker, { referredBy: user.referralCode });
            await deposit(child.id, 200);
            expect((await invitationRows(user.id)).length).toBe(0);
            const response = await request(path, user);
            expect(response.status).toBe(200);
            const body = await response.json();
            expect(path === "/progress" ? body.data.invitation[0].bonusId : body.data[0].id).toBeTruthy();
            expect((await invitationRows(user.id)).length).toBe(1);
        }
    });

    test("concurrent deposit checks and page reads create each tier once, including after collection", async () => {
        const user = await createTestUser(tracker);
        const children = await Promise.all(Array.from({ length: 3 }, () => createTestUser(tracker, { referredBy: user.referralCode })));
        for (const child of children) await deposit(child.id, 300);
        await Promise.all([
            ...children.map(child => checkAndCreateReferrerInvitationBonuses(child.id)),
            request("/progress", user), request("/bonuses", user), checkAndCreateInvitationBonuses(user.id),
        ]);
        const rows = await invitationRows(user.id);
        expect(rows.length).toBe(2);
        expect(rows.map(row => (row.metadata as { tier: number }).tier)).toEqual([0, 1]);
        for (const row of rows) expect((await request("/claim", user, { bonusId: row.id })).status).toBe(200);
        await Promise.all(children.map(child => checkAndCreateReferrerInvitationBonuses(child.id)));
        expect((await invitationRows(user.id)).length).toBe(2);
    });

    test("pending/failed deposits and indirect referrals do not unlock a tier", async () => {
        const user = await createTestUser(tracker);
        const child = await createTestUser(tracker, { referredBy: user.referralCode });
        const grandchild = await createTestUser(tracker, { referredBy: child.referralCode });
        await deposit(child.id, 199);
        await deposit(child.id, 300, "PROCESSING");
        await deposit(child.id, 300, "FAILED");
        await deposit(grandchild.id, 500);
        await checkAndCreateReferrerInvitationBonuses(child.id);
        await checkAndCreateReferrerInvitationBonuses(grandchild.id);
        expect((await invitationRows(user.id)).length).toBe(0);
        expect((await invitationRows(child.id)).length).toBe(1);
        await deposit(child.id, 1);
        await checkAndCreateReferrerInvitationBonuses(child.id);
        expect((await invitationRows(user.id)).length).toBe(1);
    });

    for (const provider of ["cxpay", "xdpay", "oxapay"] as const) {
        test(`${provider} successful payment callback creates the inviter reward before responding`, async () => {
            const user = await createTestUser(tracker);
            const child = await createTestUser(tracker, { referredBy: user.referralCode });
            const row = await deposit(child.id, 300, "PROCESSING", provider.toUpperCase());
            const verification = provider === "cxpay" ? spyOn(Cxpay, "verify") : provider === "xdpay" ? spyOn(Xdpay, "verify") : spyOn(Oxapay, "verify");
            verification.mockReturnValue(true);
            try {
                const data = provider === "oxapay"
                    ? { order_id: row.orderId, track_id: "test", status: "paid", type: "payment", amount: 5, currency: "USDT" }
                    : { orderId: row.orderId, platOrderId: "test", amount: 300, status: 1, reverse: false, remark: "test", sign: "test" };
                const response = await callbacks.request(`/${provider}/deposit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
                expect(response.status).toBe(200);
                expect(await response.text()).toBe(provider === "oxapay" ? "ok" : "success");
                expect((await invitationRows(user.id)).length).toBe(1);
            } finally { verification.mockRestore(); }
        });
    }

    test("manual UPI approval and demo deposits also unlock inviter rewards immediately", async () => {
        const admin = await createTestUser(tracker, { role: "ADMIN" });
        const adminApp = new OpenAPIHono();
        adminApp.use("*", authMiddleware);
        depositRoutes(adminApp);
        const paymentApp = new OpenAPIHono();
        paymentApp.use("*", authMiddleware);
        paymentRoutes(paymentApp);
        for (const isDemo of [false, true]) {
            const user = await createTestUser(tracker);
            const child = await createTestUser(tracker, { referredBy: user.referralCode });
            await prisma.user.update({ where: { id: child.id }, data: { isDemo } });
            const row = isDemo ? null : await deposit(child.id, 300, "PROCESSING");
            const response = await (isDemo ? paymentApp : adminApp).request(isDemo ? "/deposit" : "/deposit/manage", {
                method: "POST", headers: { "content-type": "application/json", cookie: `auth-token=${await authCookieFor(isDemo ? child : admin)}` },
                body: JSON.stringify(isDemo ? { amount: 300, method: "UPI" } : { action: "approve", orderId: row!.orderId }),
            });
            expect(response.status).toBe(200);
            expect((await invitationRows(user.id)).length).toBe(1);
        }
    });

    test("live updates reach only the inviter and unsubscribe removes the private subscription", async () => {
        await WebSocketManager.initialize();
        const user = await createTestUser(tracker);
        const other = await createTestUser(tracker);
        const child = await createTestUser(tracker, { referredBy: user.referralCode });
        const sent = [mock(), mock(), mock()];
        const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
        for (let i = 0; i < ids.length; i++) {
            sockets.push(ids[i]!);
            await WebSocketManager.addClient(ids[i]!, { readyState: 1, send: sent[i], close() {} } as any, [user, other, undefined][i]);
            await WebSocketManager.handleIncomingMessage(ids[i]!, JSON.stringify({ action: "subscribe", topic: "invitation-bonus-update" }));
        }
        await deposit(child.id, 300);
        await checkAndCreateReferrerInvitationBonuses(child.id);
        const updates = (index: number) => sent[index]!.mock.calls.map(([message]) => JSON.parse(message)).filter(message => message.topic?.startsWith("invitation-bonus-update:"));
        expect(updates(0)).toEqual([{ topic: `invitation-bonus-update:${user.id}`, data: { createdCount: 1 } }]);
        expect(updates(1).length).toBe(0);
        expect(updates(2).length).toBe(0);
        expect(await Cache.client.smembers(CacheKey.websocketClientTopics(ids[2]!))).toEqual([]);
        await WebSocketManager.handleIncomingMessage(ids[0]!, JSON.stringify({ action: "unsubscribe", topic: "invitation-bonus-update" }));
        expect(await Cache.client.smembers(CacheKey.websocketTopic(`invitation-bonus-update:${user.id}`))).toEqual([]);
    });
});
