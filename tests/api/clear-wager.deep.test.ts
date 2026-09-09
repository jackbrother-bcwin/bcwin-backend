import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@bcwin/db";
import { detectSettledIllegalBets } from "@bcwin/illegal-bets";
import { getUserWagerStatus } from "../../apps/api/src/lib/wagerEngine";
import {
    FixtureTracker,
    authCookieFor,
    cleanupByUserIds,
    createTestUser,
    ensureSystemConfig,
    get,
    post,
} from "../helpers";

describe("Permanent extra-wager clearance", () => {
    const tracker = new FixtureTracker("clearwager");
    let adminCookie: string;
    let adminId: string;
    let baseWagerFactor: number;
    let illegalPenaltyBase: number;

    beforeAll(async () => {
        const config = await ensureSystemConfig();
        baseWagerFactor = config.wager > 0 ? config.wager : 1;
        illegalPenaltyBase = config.illegalBetPenaltyFactor;
        const admin = await createTestUser(tracker, { role: "ADMIN" });
        adminId = admin.id;
        adminCookie = await authCookieFor(admin);
    });

    afterAll(async () => {
        await prisma.wagerRequirement.deleteMany({
            where: { userId: { in: tracker.userIds } },
        });
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
        });
    });

    async function fixture() {
        const user = await createTestUser(tracker, { balance: 10_000 });
        await prisma.user.update({
            where: { id: user.id },
            data: {
                hasIllegalBetPenalty: true,
                illegalBetPenaltyFactor: 9,
                // Legacy values must no longer bypass wager checks.
                zeroWagerEnabled: true,
            },
        });
        await prisma.wagerRequirement.createMany({
            data: [
                {
                    userId: user.id,
                    sourceType: "RECHARGE",
                    amount: 1_000,
                    multiplier: 9,
                    requiredWager: 9_000,
                },
                {
                    userId: user.id,
                    sourceType: "REWARD",
                    amount: 100,
                    multiplier: 4,
                    requiredWager: 400,
                },
            ],
        });
        return { user, cookie: await authCookieFor(user) };
    }

    async function clear(userId: string, reason = "Verified manual wager relief") {
        return post(`/api/v1/admin/users/${userId}/clear-extra-wagers`, {
            cookie: adminCookie,
            json: { reason },
        });
    }

    test("admin details show current multiplier and wager amounts", async () => {
        const f = await fixture();
        const details = await get(`/api/v1/admin/users/${f.user.id}`, {
            cookie: adminCookie,
        });
        expect(details.status).toBe(200);
        expect(details.json.user.currentWagerMultiplier).toBe(9);
        expect(details.json.user.depositWagerNeeded).toBe(
            Math.ceil(1_000 * baseWagerFactor)
        );
        expect(details.json.user.penaltyWagerNeeded).toBe(
            9_000 - Math.ceil(1_000 * baseWagerFactor)
        );
        expect(details.json.user.rewardWagerNeeded).toBe(400);
        expect(details.json.user.totalWagerAmount).toBe(9_400);
        expect(
            details.json.user.depositWagerNeeded +
                details.json.user.penaltyWagerNeeded +
                details.json.user.rewardWagerNeeded
        ).toBe(details.json.user.totalWagerAmount);
    });

    test("clear permanently removes reward and penalty uplift but keeps basic deposit wager", async () => {
        const f = await fixture();
        expect((await getUserWagerStatus(f.user.id)).totalNeedToBet).toBe(9_400);

        const response = await clear(f.user.id);
        expect(response.status).toBe(200);
        expect(response.json.before.totalWagerAmount).toBe(9_400);
        expect(response.json.before.depositWagerNeeded).toBe(
            Math.ceil(1_000 * baseWagerFactor)
        );
        expect(response.json.before.penaltyWagerNeeded).toBe(
            9_000 - Math.ceil(1_000 * baseWagerFactor)
        );
        expect(response.json.after.multiplier).toBe(baseWagerFactor);
        expect(response.json.after.depositWagerNeeded).toBe(
            Math.ceil(1_000 * baseWagerFactor)
        );
        expect(response.json.after.penaltyWagerNeeded).toBe(0);
        expect(response.json.after.rewardWagerNeeded).toBe(0);
        expect(
            response.json.after.depositWagerNeeded +
                response.json.after.penaltyWagerNeeded +
                response.json.after.rewardWagerNeeded
        ).toBe(response.json.after.totalWagerAmount);

        const user = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
        expect(user.hasIllegalBetPenalty).toBe(false);
        expect(user.illegalBetPenaltyFactor).toBeNull();
        expect(user.zeroWagerEnabled).toBe(false);

        const requirements = await prisma.wagerRequirement.findMany({
            where: { userId: f.user.id },
            orderBy: { sourceType: "asc" },
        });
        const recharge = requirements.find((row) => row.sourceType === "RECHARGE")!;
        const reward = requirements.find((row) => row.sourceType === "REWARD")!;
        expect(recharge.multiplier).toBe(baseWagerFactor);
        expect(recharge.requiredWager).toBe(Math.ceil(1_000 * baseWagerFactor));
        expect(recharge.isCleared).toBe(false);
        expect(reward.isCleared).toBe(true);
        expect(reward.wagerCleared).toBe(reward.requiredWager);

        const audit = await prisma.wagerClearEvent.findFirstOrThrow({
            where: { userId: f.user.id },
        });
        expect(audit.clearedById).toBe(adminId);
        expect(audit.reason).toBe("Verified manual wager relief");
        expect(audit.beforeRewardWagerNeeded).toBe(400);
        expect(audit.afterRewardWagerNeeded).toBe(0);
    });

    test("new reward and illegal activity after clearing create wager again", async () => {
        const f = await fixture();
        expect((await clear(f.user.id)).status).toBe(200);

        await prisma.wagerRequirement.create({
            data: {
                userId: f.user.id,
                sourceType: "REWARD",
                amount: 50,
                multiplier: 4,
                requiredWager: 200,
            },
        });
        const periodId = crypto.randomUUID();
        await detectSettledIllegalBets("WINGO", [
            {
                id: crypto.randomUUID(),
                userId: f.user.id,
                periodId,
                betAmount: 10,
                betType: "COLOR",
                betChoice: "RED",
            },
            {
                id: crypto.randomUUID(),
                userId: f.user.id,
                periodId,
                betAmount: 10,
                betType: "COLOR",
                betChoice: "GREEN",
            },
        ]);

        const user = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
        expect(user.hasIllegalBetPenalty).toBe(true);
        expect(user.illegalBetPenaltyFactor).toBe(illegalPenaltyBase);
        const status = await getUserWagerStatus(f.user.id);
        expect(status.depositWagerNeeded).toBe(Math.ceil(1_000 * illegalPenaltyBase));
        expect(status.penaltyWagerNeeded).toBe(
            Math.max(
                0,
                Math.ceil(1_000 * illegalPenaltyBase) -
                    Math.ceil(1_000 * baseWagerFactor)
            )
        );
        expect(status.rewardWagerNeeded).toBe(200);
    });

    test("legacy override no longer hides wager and withdrawals remain blocked", async () => {
        const f = await fixture();
        const status = await getUserWagerStatus(f.user.id);
        expect(status.totalNeedToBet).toBe(9_400);

        const withdrawal = await post("/api/v1/payment/withdraw", {
            cookie: f.cookie,
            json: { amount: 300, method: "UPI", password: f.user.plainPassword },
        });
        expect(withdrawal.status).toBe(400);
    });

    test("non-admin cannot clear wagers and reason is required", async () => {
        const f = await fixture();
        const unauthorized = await post(
            `/api/v1/admin/users/${f.user.id}/clear-extra-wagers`,
            { cookie: f.cookie, json: { reason: "Not allowed" } }
        );
        expect(unauthorized.status).toBe(401);
        expect((await clear(f.user.id, "x")).status).toBe(422);
        expect((await getUserWagerStatus(f.user.id)).totalNeedToBet).toBe(9_400);
    });
});
