import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@bcwin/db";
import { getUserWagerStatus } from "../../apps/api/src/lib/wagerEngine";
import { debitWithdrawal } from "../../apps/api/src/lib/withdrawalWager";
import {
    FixtureTracker, createTestUser, authCookieFor, cleanupByUserIds,
    ensureSystemConfig, get, post,
} from "../helpers";

describe("One-use zero wager", () => {
    const tracker = new FixtureTracker("zerowager");
    let adminCookie: string;
    beforeAll(async () => {
        await ensureSystemConfig();
        adminCookie = await authCookieFor(await createTestUser(tracker, { role: "ADMIN" }));
    });
    afterAll(async () => {
        await prisma.wagerRequirement.deleteMany({ where: { userId: { in: tracker.userIds } } });
        await cleanupByUserIds(tracker.userIds, { periodPrefix: tracker.periodPrefix });
    });

    async function fixture(balance = 10_000) {
        const user = await createTestUser(tracker, { balance });
        await prisma.user.update({ where: { id: user.id }, data: {
            hasIllegalBetPenalty: true, illegalBetPenaltyFactor: 5,
        } });
        await prisma.bank.create({ data: { userId: user.id, upiId: "zerowager@upi" } });
        await prisma.wagerRequirement.createMany({ data: [
            { userId: user.id, sourceType: "RECHARGE", amount: 4000, multiplier: 5, requiredWager: 20_000 },
            { userId: user.id, sourceType: "REWARD", amount: 2500, multiplier: 4, requiredWager: 10_000 },
        ] });
        return { user, cookie: await authCookieFor(user) };
    }
    async function toggle(id: string, enabled: boolean) {
        const result = await post(`/api/v1/admin/users/${id}/zero-wager`, {
            cookie: adminCookie, json: { zeroWagerEnabled: enabled },
        });
        expect(result.status).toBe(200);
        expect(result.json.user.zeroWagerEnabled).toBe(enabled);
    }
    function withdraw(f: Awaited<ReturnType<typeof fixture>>, amount = 300, password = f.user.plainPassword) {
        return post("/api/v1/payment/withdraw", {
            cookie: f.cookie, json: { amount, method: "UPI", password },
        });
    }

    test("admin enable/disable hides all wager without modifying requirements", async () => {
        const f = await fixture();
        const before = await prisma.wagerRequirement.findMany({ where: { userId: f.user.id } });
        expect((await getUserWagerStatus(f.user.id)).totalNeedToBet).toBe(30_000);
        await toggle(f.user.id, true);
        const info = await get("/api/v1/payment/withdraw/info", { cookie: f.cookie });
        expect(info.status).toBe(200);
        expect(info.json.data.needToBet).toBe(0);
        expect(info.json.data.depositWagerNeeded).toBe(0);
        expect(info.json.data.rewardWagerNeeded).toBe(0);
        expect(await prisma.wagerRequirement.findMany({ where: { userId: f.user.id } })).toEqual(before);
        await toggle(f.user.id, false);
        expect((await getUserWagerStatus(f.user.id)).totalNeedToBet).toBe(30_000);
    });

    test("non-admin cannot enable the override", async () => {
        const f = await fixture();
        const result = await post(`/api/v1/admin/users/${f.user.id}/zero-wager`, {
            cookie: f.cookie, json: { zeroWagerEnabled: true },
        });
        expect(result.status).toBe(401);
    });

    test("failed validation preserves override; successful request restores all wager and penalty", async () => {
        const f = await fixture();
        await toggle(f.user.id, true);
        expect((await withdraw(f, 300, "wrong-password")).status).toBe(400);
        expect((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).zeroWagerEnabled).toBe(true);
        expect((await withdraw(f)).status).toBe(200);
        const user = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
        expect(user.zeroWagerEnabled).toBe(false);
        expect(user.hasIllegalBetPenalty).toBe(true);
        expect(user.illegalBetPenaltyFactor).toBe(5);
        expect((await getUserWagerStatus(f.user.id)).totalNeedToBet).toBe(30_000);
        const details = await get(`/api/v1/admin/users/${f.user.id}`, { cookie: adminCookie });
        expect(details.json.user.zeroWagerEnabled).toBe(false);
        expect((await withdraw(f)).status).toBe(400);
        await toggle(f.user.id, true);
        expect((await withdraw(f)).status).toBe(200);
    });

    test("simultaneous requests consume the override only once", async () => {
        const f = await fixture();
        await toggle(f.user.id, true);
        const results = await Promise.all([withdraw(f), withdraw(f)]);
        expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
        expect(await prisma.withdraw.count({ where: { userId: f.user.id } })).toBe(1);
        expect((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).balance).toBe(9700);
    });

    test("withdrawing down to zero does not wipe restored wager", async () => {
        const f = await fixture(300);
        await toggle(f.user.id, true);
        expect((await withdraw(f)).status).toBe(200);
        expect((await getUserWagerStatus(f.user.id)).totalNeedToBet).toBe(30_000);
    });

    test("transaction failure rolls back override consumption and debit", async () => {
        const f = await fixture();
        await toggle(f.user.id, true);
        await expect(prisma.$transaction(async (tx) => {
            await debitWithdrawal(tx, f.user.id, 300, 10, new Date(0), new Date("2100-01-01"));
            throw new Error("withdrawal creation failed");
        })).rejects.toThrow("withdrawal creation failed");
        const user = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
        expect(user.zeroWagerEnabled).toBe(true);
        expect(user.balance).toBe(10_000);
    });

    test("cancelling the submitted withdrawal does not re-enable zero wager", async () => {
        const f = await fixture();
        await toggle(f.user.id, true);
        expect((await withdraw(f)).status).toBe(200);
        const order = await prisma.withdraw.findFirstOrThrow({ where: { userId: f.user.id } });
        const cancelled = await post("/api/v1/payment/withdraw/cancel", {
            cookie: f.cookie, json: { orderId: order.orderId },
        });
        expect(cancelled.status).toBe(200);
        expect((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).zeroWagerEnabled).toBe(false);
        expect((await getUserWagerStatus(f.user.id)).totalNeedToBet).toBe(30_000);
    });
});
