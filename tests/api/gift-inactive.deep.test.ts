/**
 * Inactive gift codes must not redeem (ADR-0042).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@bcwin/db";
import {
    FixtureTracker,
    authCookieFor,
    cleanupByUserIds,
    createTestUser,
    ensureSystemConfig,
    post,
} from "../helpers";

describe("Inactive gift codes", () => {
    const tracker = new FixtureTracker("gin");
    let cookie: string;
    let userId: string;
    const codes: string[] = [];

    beforeAll(async () => {
        await ensureSystemConfig();
        const user = await createTestUser(tracker, { balance: 0 });
        userId = user.id;
        cookie = await authCookieFor(user);
    });

    afterAll(async () => {
        await prisma.giftRedemption.deleteMany({ where: { userId } });
        await prisma.gift.deleteMany({ where: { code: { in: codes } } });
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
            giftCodePrefix: tracker.giftPrefix,
            orderIdPrefix: tracker.orderPrefix,
        });
    });

    test("inactive code is rejected and does not credit", async () => {
        const code = `${tracker.giftPrefix}OFF`;
        codes.push(code);
        await prisma.gift.create({
            data: {
                code,
                type: "FIXED",
                amount: 50,
                totalRedeemable: 10,
                totalRedeemed: 0,
                isActive: false,
            },
        });

        const res = await post("/api/v1/redeem", { cookie, json: { code } });
        expect(res.status).toBe(400);
        expect(String(res.json?.error ?? "")).toMatch(/inactive/i);

        const u = await prisma.user.findUnique({ where: { id: userId } });
        expect(Number(u?.balance ?? 0)).toBe(0);
        const claims = await prisma.giftRedemption.count({ where: { userId } });
        expect(claims).toBe(0);
    });

    test("inactive attempt does not consume the daily cap", async () => {
        const off = `${tracker.giftPrefix}OFF2`;
        const on = `${tracker.giftPrefix}ON`;
        codes.push(off, on);
        await prisma.gift.create({
            data: {
                code: off,
                type: "FIXED",
                amount: 50,
                totalRedeemable: 10,
                totalRedeemed: 0,
                isActive: false,
            },
        });
        await prisma.gift.create({
            data: {
                code: on,
                type: "FIXED",
                amount: 15,
                totalRedeemable: 10,
                totalRedeemed: 0,
                isActive: true,
            },
        });

        const blocked = await post("/api/v1/redeem", {
            cookie,
            json: { code: off },
        });
        expect(blocked.status).toBe(400);

        const ok = await post("/api/v1/redeem", { cookie, json: { code: on } });
        expect(ok.status).toBe(200);
        expect(Number(ok.json?.amount)).toBe(15);
        const u = await prisma.user.findUnique({ where: { id: userId } });
        expect(Number(u?.balance ?? 0)).toBe(15);
    });
});
