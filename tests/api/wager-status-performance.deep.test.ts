import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@bcwin/db";
import {
    getUserWagerStatus,
    getUserWagerStatusReadOnly,
} from "../../apps/api/src/lib/wagerEngine";
import {
    FixtureTracker,
    cleanupByUserIds,
    createActiveWingoPeriod,
    createTestUser,
    ensureSystemConfig,
} from "../helpers";

describe("Set-based wager status", () => {
    const tracker = new FixtureTracker("wagerperf");

    beforeAll(async () => {
        await ensureSystemConfig();
    });

    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
        });
    });

    test("calculates and persists 100 requirements without transaction fan-out", async () => {
        const user = await createTestUser(tracker, { balance: 10_000 });
        const requirementTime = new Date(Date.now() - 60_000);
        await prisma.wagerRequirement.createMany({
            data: Array.from({ length: 100 }, () => ({
                userId: user.id,
                sourceType: "REWARD" as const,
                amount: 10,
                multiplier: 1,
                requiredWager: 10,
                createdAt: requirementTime,
            })),
        });
        const period = await createActiveWingoPeriod(tracker, 300);
        await prisma.wingoBet.create({
            data: {
                userId: user.id,
                periodId: period.id,
                betAmount: 500,
                contractAmount: 490,
                betType: "COLOR",
                betChoice: "RED",
                createdAt: new Date(requirementTime.getTime() + 1_000),
            },
        });

        const startedAt = performance.now();
        const preview = await getUserWagerStatusReadOnly(user.id);
        expect(performance.now() - startedAt).toBeLessThan(5_000);
        expect(preview.rewardWagerNeeded).toBe(500);
        expect(preview.totalNeedToBet).toBe(500);
        expect(preview.activeRequirementsCount).toBe(100);
        expect(await prisma.wagerRequirement.count({
            where: { userId: user.id, isCleared: true },
        })).toBe(0);

        const persisted = await getUserWagerStatus(user.id);
        expect(persisted.rewardWagerNeeded).toBe(500);
        expect(await prisma.wagerRequirement.count({
            where: { userId: user.id, isCleared: true },
        })).toBe(50);
    });
});
