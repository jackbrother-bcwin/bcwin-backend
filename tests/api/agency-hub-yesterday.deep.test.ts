/**
 * Agency hub Direct / Team card — IST yesterday only (ADR-0025).
 *
 * Undated GET /user/team/overview stays lifetime + TeamMetrics.
 * ?date=YYYY-MM-DD: register / SUCCESS deposits / first SUCCESS for that day.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import {
    parseYmdStartIst,
    shiftYmdIst,
    ymdIst,
} from "../../apps/api/src/lib/istDate";
import {
    get,
    FixtureTracker,
    createTestUser,
    authCookieFor,
    cleanupByUserIds,
    ensureSystemConfig,
} from "../helpers";

function n(v: unknown): number {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
}

function atIst(ymd: string, hour = 12): Date {
    return new Date(parseYmdStartIst(ymd).getTime() + hour * 3600 * 1000);
}

describe("Agency hub yesterday subordinate card (ADR-0025)", () => {
    const tracker = new FixtureTracker("ahy");
    const today = ymdIst();
    const yest = shiftYmdIst(today, -1);
    const oldDay = shiftYmdIst(today, -10);

    let parent: Awaited<ReturnType<typeof createTestUser>>;
    let l1Old: Awaited<ReturnType<typeof createTestUser>>;
    let l1New: Awaited<ReturnType<typeof createTestUser>>;
    let l2New: Awaited<ReturnType<typeof createTestUser>>;
    let cookie: string;

    beforeAll(async () => {
        await ensureSystemConfig();
        parent = await createTestUser(tracker, { balance: 0 });
        l1Old = await createTestUser(tracker, {
            balance: 0,
            referredBy: parent.referralCode,
        });
        l1New = await createTestUser(tracker, {
            balance: 0,
            referredBy: parent.referralCode,
        });
        l2New = await createTestUser(tracker, {
            balance: 0,
            referredBy: l1Old.referralCode,
        });
        cookie = await authCookieFor(parent);

        await prisma.user.update({
            where: { id: l1Old.id },
            data: { createdAt: atIst(oldDay) },
        });
        await prisma.user.update({
            where: { id: l1New.id },
            data: { createdAt: atIst(yest) },
        });
        await prisma.user.update({
            where: { id: l2New.id },
            data: { createdAt: atIst(yest, 15) },
        });

        await prisma.deposit.createMany({
            data: [
                {
                    orderId: `${tracker.orderPrefix}old-first`,
                    amount: 500,
                    method: "UPI",
                    status: "SUCCESS",
                    userId: l1Old.id,
                    createdAt: atIst(oldDay),
                },
                {
                    orderId: `${tracker.orderPrefix}old-yest`,
                    amount: 100,
                    method: "UPI",
                    status: "SUCCESS",
                    userId: l1Old.id,
                    createdAt: atIst(yest),
                },
                {
                    orderId: `${tracker.orderPrefix}new-yest`,
                    amount: 40,
                    method: "UPI",
                    status: "SUCCESS",
                    userId: l1New.id,
                    createdAt: atIst(yest, 14),
                },
                {
                    orderId: `${tracker.orderPrefix}l2-yest`,
                    amount: 70,
                    method: "UPI",
                    status: "SUCCESS",
                    userId: l2New.id,
                    createdAt: atIst(yest, 16),
                },
                {
                    orderId: `${tracker.orderPrefix}pend`,
                    amount: 999,
                    method: "UPI",
                    status: "PROCESSING",
                    userId: l1Old.id,
                    createdAt: atIst(yest),
                },
            ],
        });

        await Cache.del(CacheKey.teamOverview(parent.id));
        await Cache.del(`${CacheKey.teamOverview(parent.id)}:${yest}`);
    });

    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
            giftCodePrefix: tracker.giftPrefix,
            orderIdPrefix: tracker.orderPrefix,
        });
        await Cache.del(CacheKey.teamOverview(parent.id));
        await Cache.del(`${CacheKey.teamOverview(parent.id)}:${yest}`);
    });

    test("undated overview stays lifetime and writes TeamMetrics", async () => {
        const res = await get("/api/v1/user/team/overview", { cookie });
        expect(res.status).toBe(200);
        const d = res.json?.data ?? {};
        expect(n(d.directTeamSize)).toBe(2);
        expect(n(d.totalTeamSize)).toBe(3);
        expect(n(d.directTeamDeposit)).toBe(640);
        expect(n(d.totalTeamDeposit)).toBe(710);
        expect(n(d.directDepositCount)).toBe(3);
        expect(n(d.teamDepositCount)).toBe(4);
        expect(n(d.directFirstDepositUsers)).toBe(2);
        expect(n(d.teamFirstDepositUsers)).toBe(3);

        await new Promise((r) => setTimeout(r, 80));
        const metrics = await prisma.teamMetrics.findUnique({
            where: { userId: parent.id },
        });
        expect(metrics?.directTeamSize).toBe(2);
        expect(metrics?.totalTeamSize).toBe(3);
        expect(metrics?.directTeamDeposit).toBe(640);
        expect(metrics?.totalTeamDeposit).toBe(710);
    });

    test("dated overview is yesterday events only (L1 vs L2–L6)", async () => {
        const res = await get("/api/v1/user/team/overview", {
            cookie,
            query: { date: yest },
        });
        expect(res.status).toBe(200);
        const d = res.json?.data ?? {};
        expect(n(d.directTeamSize)).toBe(1);
        expect(n(d.totalTeamSize)).toBe(2);
        expect(n(d.directTeamDeposit)).toBe(140);
        expect(n(d.totalTeamDeposit)).toBe(210);
        expect(n(d.directDepositCount)).toBe(2);
        expect(n(d.teamDepositCount)).toBe(3);
        expect(n(d.directFirstDepositUsers)).toBe(1);
        expect(n(d.teamFirstDepositUsers)).toBe(2);
    });

    test("dated overview does not overwrite lifetime TeamMetrics", async () => {
        await get("/api/v1/user/team/overview", {
            cookie,
            query: { date: yest },
        });
        const metrics = await prisma.teamMetrics.findUnique({
            where: { userId: parent.id },
        });
        expect(metrics?.directTeamSize).toBe(2);
        expect(metrics?.totalTeamSize).toBe(3);
        expect(metrics?.totalTeamDeposit).toBe(710);
    });

    test("invalid date is 400", async () => {
        const res = await get("/api/v1/user/team/overview", {
            cookie,
            query: { date: "18-08-2026" },
        });
        expect(res.status).toBe(400);
    });

    test("hub Direct/Team card matches the two overview calls", async () => {
        await Cache.del(`user:${parent.id}:agency-hub`);
        const [hub, life, yestOv] = await Promise.all([
            get("/api/v1/user/team/hub", { cookie }),
            get("/api/v1/user/team/overview", { cookie }),
            get("/api/v1/user/team/overview", {
                cookie,
                query: { date: yest },
            }),
        ]);
        expect(hub.status).toBe(200);
        const h = hub.json?.data ?? {};
        const L = life.json?.data ?? {};
        const Y = yestOv.json?.data ?? {};
        for (const k of [
            "directTeamSize",
            "totalTeamSize",
            "totalTeamDeposit",
            "directTeamDeposit",
            "directDepositCount",
            "teamDepositCount",
            "directFirstDepositUsers",
            "teamFirstDepositUsers",
            "totalCommissionEarned",
        ] as const) {
            expect(n(h.lifetime?.[k])).toBe(n(L[k]));
            expect(n(h.yesterday?.[k])).toBe(n(Y[k]));
        }
        expect(n(h.yesterday.directTeamSize)).toBe(1);
        expect(n(h.yesterday.totalTeamSize)).toBe(2);
        expect(n(h.lifetime.directTeamSize)).toBe(2);
        expect(n(h.lifetime.totalTeamSize)).toBe(3);
    });
});
