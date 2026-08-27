/**
 * Brand gift codes: BCWIN0X + 25 = 32 chars, no hyphen.
 * Redeem trims + uppercases; old YYYYMMDD-… and shorter BCWIN0X+8 still match.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@bcwin/db";
import {
    GIFT_CODE_LEN,
    GIFT_CODE_PREFIX,
    generateGiftCode,
    giftCodeLookupCandidates,
    isBrandGiftCode,
    isUniqueConstraintError,
    mintGiftCode,
    normalizeGiftCode,
} from "../../apps/api/src/lib/giftCode";
import {
    FixtureTracker,
    authCookieFor,
    cleanupByUserIds,
    createTestUser,
    ensureSystemConfig,
    post,
} from "../helpers";

describe("Gift code format", () => {
    test("new codes are BCWIN0X + 25 A–Z/0–9 (32 chars) with no hyphen", () => {
        const codes = new Set<string>();
        for (let i = 0; i < 40; i++) {
            const code = generateGiftCode();
            expect(isBrandGiftCode(code)).toBe(true);
            expect(code.includes("-")).toBe(false);
            expect(code.startsWith(GIFT_CODE_PREFIX)).toBe(true);
            expect(code.length).toBe(32);
            expect(code.length).toBe(GIFT_CODE_LEN);
            codes.add(code);
        }
        expect(codes.size).toBe(40);
        expect(isBrandGiftCode("BCWIN0XK7M2Q9P4")).toBe(false);
    });

    test("normalize trims and uppercases; keeps hyphens", () => {
        expect(normalizeGiftCode("  bcwin0xk7m2q9p4  ")).toBe("BCWIN0XK7M2Q9P4");
        expect(normalizeGiftCode("20260825-84729100338471")).toBe(
            "20260825-84729100338471"
        );
        expect(giftCodeLookupCandidates("  bcwin0xk7m2q9p4  ")).toEqual([
            "bcwin0xk7m2q9p4",
            "BCWIN0XK7M2Q9P4",
        ]);
        expect(giftCodeLookupCandidates("20260825-84729100338471")).toEqual([
            "20260825-84729100338471",
        ]);
    });

    test("mint retries on unique conflict then succeeds", async () => {
        let n = 0;
        const code = await mintGiftCode(async () => {
            n += 1;
            if (n < 3) {
                throw Object.assign(new Error("unique"), { code: "P2002" });
            }
        });
        expect(n).toBe(3);
        expect(isBrandGiftCode(code)).toBe(true);
        expect(isUniqueConstraintError({ code: "P2002" })).toBe(true);
        expect(isUniqueConstraintError({ code: "P2003" })).toBe(false);
    });
});

describe("Gift redeem lookup (ADR-0040)", () => {
    const tracker = new FixtureTracker("gcf");
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

    test("lowercase brand code redeems", async () => {
        const stored = generateGiftCode();
        codes.push(stored);
        await prisma.gift.create({
            data: {
                code: stored,
                type: "FIXED",
                amount: 12,
                totalRedeemable: 10,
                totalRedeemed: 0,
                isActive: true,
            },
        });
        const res = await post("/api/v1/redeem", {
            cookie,
            json: { code: `  ${stored.toLowerCase()}  ` },
        });
        expect(res.status).toBe(200);
        expect(res.json?.success).toBe(true);
        expect(Number(res.json?.amount)).toBe(12);
    });

    test("shorter stored BCWIN0X+8 still matches", async () => {
        const tail = tracker.runId
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "")
            .slice(-8)
            .padEnd(8, "0");
        const stored = `${GIFT_CODE_PREFIX}${tail}`;
        expect(stored.length).toBe(15);
        codes.push(stored);
        await prisma.gift.create({
            data: {
                code: stored,
                type: "FIXED",
                amount: 9,
                totalRedeemable: 10,
                totalRedeemed: 0,
                isActive: true,
            },
        });
        const res = await post("/api/v1/redeem", {
            cookie,
            json: { code: stored.toLowerCase() },
        });
        expect(res.status).toBe(200);
        expect(Number(res.json?.amount)).toBe(9);
    });

    test("legacy hyphen code still matches", async () => {
        const stored = `${tracker.giftPrefix}LEGACY-1`;
        codes.push(stored);
        await prisma.gift.create({
            data: {
                code: stored,
                type: "FIXED",
                amount: 8,
                totalRedeemable: 10,
                totalRedeemed: 0,
                isActive: true,
            },
        });
        const res = await post("/api/v1/redeem", {
            cookie,
            json: { code: stored },
        });
        expect(res.status).toBe(200);
        expect(Number(res.json?.amount)).toBe(8);
    });
});
