/**
 * Recharge wager must follow live admin factor (penalty / config), not the
 * 1x snapshot taken at deposit time.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@bcwin/db";
import {
    createWagerRequirement,
    getUserWagerStatus,
} from "../../apps/api/src/lib/wagerEngine";
import {
    FixtureTracker,
    cleanupByUserIds,
    createActiveWingoPeriod,
    createTestUser,
    ensureSystemConfig,
} from "../helpers";

describe("Live recharge wager vs admin penalty", () => {
    const tracker = new FixtureTracker("wagerpen");
    let userId: string;

    beforeAll(async () => {
        await ensureSystemConfig();
        const user = await createTestUser(tracker, { balance: 10_000 });
        userId = user.id;
    });

    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
        });
    });

    async function wipeWagerAndBets() {
        await prisma.wagerRequirement.deleteMany({ where: { userId } });
        await prisma.wingoBet.deleteMany({ where: { userId } });
        await prisma.user.update({
            where: { id: userId },
            data: {
                hasIllegalBetPenalty: false,
                illegalBetPenaltyFactor: null,
                balance: 10_000,
            },
        });
    }

    test("new deposit while 3x penalty is already on is 3x", async () => {
        await wipeWagerAndBets();
        await prisma.user.update({
            where: { id: userId },
            data: {
                hasIllegalBetPenalty: true,
                illegalBetPenaltyFactor: 3,
            },
        });
        const req = await createWagerRequirement(
            prisma,
            userId,
            "RECHARGE",
            100
        );
        expect(req?.multiplier).toBe(3);
        expect(req?.requiredWager).toBe(300);
        const status = await getUserWagerStatus(userId);
        expect(status.depositWagerNeeded).toBe(300);
        expect(status.isWithdrawalFrozen).toBe(true);
    });

    test("admin 3x after a 1x deposit triples remaining (does not stay 1x)", async () => {
        await wipeWagerAndBets();
        const req = await createWagerRequirement(
            prisma,
            userId,
            "RECHARGE",
            100
        );
        expect(req?.requiredWager).toBe(100);

        await prisma.user.update({
            where: { id: userId },
            data: {
                hasIllegalBetPenalty: true,
                illegalBetPenaltyFactor: 3,
            },
        });

        const status = await getUserWagerStatus(userId);
        expect(status.depositWagerNeeded).toBe(300);
        expect(status.isWithdrawalFrozen).toBe(true);

        const row = await prisma.wagerRequirement.findFirstOrThrow({
            where: { userId, sourceType: "RECHARGE" },
        });
        expect(row.multiplier).toBe(3);
        expect(row.requiredWager).toBe(300);
        expect(row.isCleared).toBe(false);
    });

    test("cleared 1x then 3x penalty reopens the remaining 2x", async () => {
        await wipeWagerAndBets();
        await createWagerRequirement(prisma, userId, "RECHARGE", 100);

        const period = await createActiveWingoPeriod(tracker, 300);
        await prisma.wingoBet.create({
            data: {
                userId,
                periodId: period.id,
                betAmount: 100,
                contractAmount: 98,
                betType: "COLOR",
                betChoice: "RED",
            },
        });

        const cleared = await getUserWagerStatus(userId);
        expect(cleared.depositWagerNeeded).toBe(0);
        expect(cleared.isWithdrawalFrozen).toBe(false);

        await prisma.user.update({
            where: { id: userId },
            data: {
                hasIllegalBetPenalty: true,
                illegalBetPenaltyFactor: 3,
            },
        });

        const status = await getUserWagerStatus(userId);
        expect(status.depositWagerNeeded).toBe(200);
        expect(status.isWithdrawalFrozen).toBe(true);
    });

    test("per-user 5x wins over config 3x", async () => {
        await wipeWagerAndBets();
        await prisma.user.update({
            where: { id: userId },
            data: {
                hasIllegalBetPenalty: true,
                illegalBetPenaltyFactor: 5,
            },
        });
        await createWagerRequirement(prisma, userId, "RECHARGE", 100);
        expect((await getUserWagerStatus(userId)).depositWagerNeeded).toBe(500);
    });

    test("raising 3x to 5x increases remaining on the same deposit", async () => {
        await wipeWagerAndBets();
        await prisma.user.update({
            where: { id: userId },
            data: {
                hasIllegalBetPenalty: true,
                illegalBetPenaltyFactor: 3,
            },
        });
        await createWagerRequirement(prisma, userId, "RECHARGE", 100);
        expect((await getUserWagerStatus(userId)).depositWagerNeeded).toBe(300);

        await prisma.user.update({
            where: { id: userId },
            data: { illegalBetPenaltyFactor: 5 },
        });
        expect((await getUserWagerStatus(userId)).depositWagerNeeded).toBe(500);
    });
});
