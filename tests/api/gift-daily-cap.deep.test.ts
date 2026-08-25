/**
 * Gift redeem: 3 successful claims per user per IST day (ADR-0038).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "@bcwin/db";
import { GIFT_CLAIMS_PER_IST_DAY } from "@bcwin/config";
import { parseYmdStartIst, shiftYmdIst, ymdIst } from "../../apps/api/src/lib/istDate";
import {
    post,
    FixtureTracker,
    createTestUser,
    authCookieFor,
    cleanupByUserIds,
    ensureSystemConfig,
} from "../helpers";

describe("Gift daily claim cap (ADR-0038)", () => {
    const tracker = new FixtureTracker("gdc");
    let cookie: string;
    let userId: string;
    const codes: string[] = [];

    beforeAll(async () => {
        await ensureSystemConfig();
        const user = await createTestUser(tracker, { balance: 0 });
        userId = user.id;
        cookie = await authCookieFor(user);
        for (let i = 0; i < 5; i++) {
            const code = `${tracker.giftPrefix}${i}`;
            codes.push(code);
            await prisma.gift.create({
                data: {
                    code,
                    type: "FIXED",
                    amount: 10,
                    totalRedeemable: 100,
                    totalRedeemed: 0,
                    isActive: true,
                },
            });
        }
    });

    afterAll(async () => {
        await prisma.giftRedemption.deleteMany({
            where: { userId },
        });
        await prisma.gift.deleteMany({
            where: { code: { in: codes } },
        });
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
            giftCodePrefix: tracker.giftPrefix,
            orderIdPrefix: tracker.orderPrefix,
        });
    });

    test("first 3 codes succeed; 4th is blocked for today", async () => {
        expect(GIFT_CLAIMS_PER_IST_DAY).toBe(3);
        for (let i = 0; i < 3; i++) {
            const res = await post("/api/v1/redeem", {
                cookie,
                json: { code: codes[i] },
            });
            expect(res.status).toBe(200);
            expect(res.json?.success).toBe(true);
            expect(Number(res.json?.amount)).toBe(10);
        }
        const blocked = await post("/api/v1/redeem", {
            cookie,
            json: { code: codes[3] },
        });
        expect(blocked.status).toBe(400);
        expect(String(blocked.json?.error ?? "")).toMatch(/3 gift codes today/i);

        const u = await prisma.user.findUnique({ where: { id: userId } });
        expect(Number(u?.balance ?? 0)).toBe(30);
    });

    test("bad code does not consume the daily cap", async () => {
        const res = await post("/api/v1/redeem", {
            cookie,
            json: { code: "NO-SUCH-CODE" },
        });
        expect(res.status).toBe(404);
        const still = await post("/api/v1/redeem", {
            cookie,
            json: { code: codes[3] },
        });
        expect(still.status).toBe(400);
    });

    test("after moving claims to yesterday, a 4th code works today", async () => {
        const yest = shiftYmdIst(ymdIst(), -1);
        const yestNoon = new Date(
            parseYmdStartIst(yest).getTime() + 12 * 3600 * 1000
        );
        await prisma.giftRedemption.updateMany({
            where: { userId },
            data: { createdAt: yestNoon },
        });
        const res = await post("/api/v1/redeem", {
            cookie,
            json: { code: codes[3] },
        });
        expect(res.status).toBe(200);
        expect(Number(res.json?.amount)).toBe(10);
    });
});
