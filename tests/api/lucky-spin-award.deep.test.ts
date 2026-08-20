/**
 * Lucky Spin awards per SUCCESS recharge, once per order (ADR-0034).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "@bcwin/db";
import { DEFAULT_LUCKY_SPIN_RULES } from "../../apps/api/src/lib/luckySpinTiers";
import {
    get,
    FixtureTracker,
    createTestUser,
    authCookieFor,
    cleanupByUserIds,
    ensureSystemConfig,
} from "../helpers";

describe("Lucky Spin per-deposit award (ADR-0034)", () => {
    const tracker = new FixtureTracker("lsa");
    let user: Awaited<ReturnType<typeof createTestUser>>;
    let cookie: string;

    beforeAll(async () => {
        await ensureSystemConfig();
        user = await createTestUser(tracker, { balance: 0 });
        cookie = await authCookieFor(user);

        await prisma.luckySpinRule.updateMany({
            where: { kind: "LUCKY" },
            data: { isActive: false },
        });
        for (const r of DEFAULT_LUCKY_SPIN_RULES) {
            const found = await prisma.luckySpinRule.findFirst({
                where: { kind: "LUCKY", minDeposit: r.minDeposit },
            });
            if (found) {
                await prisma.luckySpinRule.update({
                    where: { id: found.id },
                    data: { spinChances: r.spinChances, isActive: true },
                });
            } else {
                await prisma.luckySpinRule.create({
                    data: {
                        kind: "LUCKY",
                        minDeposit: r.minDeposit,
                        spinChances: r.spinChances,
                        isActive: true,
                    },
                });
            }
        }
    });

    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
            giftCodePrefix: tracker.giftPrefix,
            orderIdPrefix: tracker.orderPrefix,
        });
    });

    async function addDeposit(amount: number, suffix: string) {
        return prisma.deposit.create({
            data: {
                orderId: `${tracker.orderPrefix}${suffix}`,
                amount,
                method: "UPI",
                status: "SUCCESS",
                userId: user.id,
            },
        });
    }

    test("₹199 awards 0; ₹7000 awards +1; same row not double-counted", async () => {
        const low = await addDeposit(199, "low");
        const mid = await addDeposit(7000, "mid");

        const res = await get("/api/v1/user/activity/lucky-spin", { cookie });
        expect(res.status).toBe(200);
        expect(Number(res.json?.data?.availableSpins)).toBe(1);

        const again = await get("/api/v1/user/activity/lucky-spin", { cookie });
        expect(Number(again.json?.data?.availableSpins)).toBe(1);

        const lowRow = await prisma.deposit.findUnique({ where: { id: low.id } });
        const midRow = await prisma.deposit.findUnique({ where: { id: mid.id } });
        const lowMeta = (lowRow?.metadata ?? {}) as Record<string, unknown>;
        const midMeta = (midRow?.metadata ?? {}) as Record<string, unknown>;
        expect(Number(lowMeta.luckySpinsAwarded)).toBe(0);
        expect(Number(midMeta.luckySpinsAwarded)).toBe(1);
    });

    test("second recharge ₹15000 adds +2 (not stacked with first deposit's tiers)", async () => {
        await addDeposit(15000, "hi");
        const res = await get("/api/v1/user/activity/lucky-spin", { cookie });
        expect(res.status).toBe(200);
        expect(Number(res.json?.data?.availableSpins)).toBe(3);
    });
});
