/**
 * Agency hub + rebate day-totals (ADR-0043). No FE paging of rebate rows.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@bcwin/db";
import { parseYmdStartIst, shiftYmdIst, ymdIst } from "../../apps/api/src/lib/istDate";
import { Cache, CacheKey } from "@bcwin/cache";
import {
    FixtureTracker,
    authCookieFor,
    cleanupByUserIds,
    createTestUser,
    ensureSystemConfig,
    get,
} from "../helpers";

function atIst(ymd: string, hour = 12): Date {
    return new Date(parseYmdStartIst(ymd).getTime() + hour * 3600 * 1000);
}

function n(v: unknown): number {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
}

const OVERVIEW_KEYS = [
    "directTeamSize",
    "totalTeamSize",
    "totalTeamBetting",
    "totalTeamDeposit",
    "totalCommissionEarned",
    "directTeamBetting",
    "directTeamDeposit",
    "directDepositCount",
    "teamDepositCount",
    "directFirstDepositUsers",
    "teamFirstDepositUsers",
] as const;

function pickOverview(d: Record<string, unknown> | undefined) {
    const out: Record<string, number> = {};
    for (const k of OVERVIEW_KEYS) out[k] = n(d?.[k]);
    return out;
}

async function pageRebateHistory(
    cookie: string,
    query: Record<string, string | number>
): Promise<Array<{ amount: number; createdAt: string; settled?: boolean }>> {
    const out: Array<{ amount: number; createdAt: string; settled?: boolean }> =
        [];
    let page = 1;
    let totalPages = 1;
    do {
        const res = await get("/api/v1/user/rebate/history", {
            cookie,
            query: { ...query, page, limit: 50 },
        });
        expect(res.status).toBe(200);
        out.push(...(res.json?.data ?? []));
        totalPages = Math.max(1, Number(res.json?.totalPages ?? 1));
        page += 1;
    } while (page <= totalPages && page <= 40);
    return out;
}

describe("Agency hub + rebate day totals (ADR-0043)", () => {
    const tracker = new FixtureTracker("afp");
    const today = ymdIst();
    const yest = shiftYmdIst(today, -1);
    const older = shiftYmdIst(today, -3);

    let parent: Awaited<ReturnType<typeof createTestUser>>;
    let l1: Awaited<ReturnType<typeof createTestUser>>;
    let cookie: string;

    beforeAll(async () => {
        await ensureSystemConfig();
        parent = await createTestUser(tracker, { balance: 0 });
        l1 = await createTestUser(tracker, {
            balance: 0,
            referredBy: parent.referralCode,
        });
        cookie = await authCookieFor(parent);

        await prisma.rebate.createMany({
            data: [
                {
                    userId: parent.id,
                    fromUserId: l1.id,
                    layer: 1,
                    gameCategory: "LOTTERY",
                    game: "WINGO",
                    betAmount: 1000,
                    amount: 10,
                    rate: 0.01,
                    settled: true,
                    createdAt: atIst(yest),
                },
                {
                    userId: parent.id,
                    fromUserId: l1.id,
                    layer: 1,
                    gameCategory: "LOTTERY",
                    game: "WINGO",
                    betAmount: 500,
                    amount: 5,
                    rate: 0.01,
                    settled: true,
                    createdAt: atIst(older),
                },
                {
                    userId: parent.id,
                    fromUserId: l1.id,
                    layer: 1,
                    gameCategory: "LOTTERY",
                    game: "WINGO",
                    betAmount: 200,
                    amount: 3,
                    rate: 0.01,
                    settled: false,
                    createdAt: atIst(today, 10),
                },
            ],
        });
        await Cache.del(`user:${parent.id}:agency-hub`);
        await Cache.del(CacheKey.teamOverview(parent.id));
        await Cache.del(`${CacheKey.teamOverview(parent.id)}:${yest}`);
        await Cache.del(`user:${parent.id}:rebate-day-totals`);
        await Cache.del(CacheKey.rebateHistory(parent.id));
    });

    afterAll(async () => {
        await prisma.rebate.deleteMany({ where: { userId: parent.id } });
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
            giftCodePrefix: tracker.giftPrefix,
            orderIdPrefix: tracker.orderPrefix,
        });
    });

    test("day-totals groups IST days without paging history", async () => {
        const res = await get("/api/v1/user/rebate/day-totals", {
            cookie,
            query: { settled: "true" },
        });
        expect(res.status).toBe(200);
        const rows = (res.json?.data ?? []) as Array<{ date: string; total: number }>;
        const y = rows.find((r) => r.date === yest);
        const o = rows.find((r) => r.date === older);
        expect(Number(y?.total)).toBe(10);
        expect(Number(o?.total)).toBe(5);
    });

    test("agency hub is one payload", async () => {
        const res = await get("/api/v1/user/team/hub", { cookie });
        expect(res.status).toBe(200);
        expect(res.json?.success).toBe(true);
        const d = res.json?.data;
        expect(d?.lifetime).toBeTruthy();
        expect(d?.yesterday).toBeTruthy();
        expect(Number(d?.yesterdayCommission)).toBe(10);
        expect(Number(d?.weekCommission)).toBeGreaterThanOrEqual(10);
        expect(typeof d?.lifetime.totalTeamSize).toBe("number");
    });

    test("hub lifetime/yesterday match the old two overview calls", async () => {
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
        expect(life.status).toBe(200);
        expect(yestOv.status).toBe(200);
        expect(pickOverview(hub.json?.data?.lifetime)).toEqual(
            pickOverview(life.json?.data)
        );
        expect(pickOverview(hub.json?.data?.yesterday)).toEqual(
            pickOverview(yestOv.json?.data)
        );
    });

    test("hub yesterday commission matches /rebate/daily and history sum", async () => {
        const [hub, daily, hist] = await Promise.all([
            get("/api/v1/user/team/hub", { cookie }),
            get("/api/v1/user/rebate/daily", {
                cookie,
                query: { date: yest },
            }),
            pageRebateHistory(cookie, {
                startDate: yest,
                endDate: yest,
                settled: "true",
            }),
        ]);
        const histSum = hist.reduce((s, r) => s + n(r.amount), 0);
        expect(n(hub.json?.data?.yesterdayCommission)).toBe(10);
        expect(n(daily.json?.data?.totalCommission)).toBe(10);
        expect(histSum).toBe(10);
    });

    test("hub week sum matches paging history settled=all (old FE)", async () => {
        const weekStart = shiftYmdIst(today, -6);
        const [hub, hist] = await Promise.all([
            get("/api/v1/user/team/hub", { cookie }),
            pageRebateHistory(cookie, {
                startDate: weekStart,
                endDate: today,
                settled: "all",
            }),
        ]);
        const histSum = hist.reduce((s, r) => s + n(r.amount), 0);
        expect(n(hub.json?.data?.weekCommission)).toBe(histSum);
        expect(histSum).toBe(18);
    });

    test("day-totals match grouping paged history by IST day", async () => {
        const [totals, hist] = await Promise.all([
            get("/api/v1/user/rebate/day-totals", {
                cookie,
                query: { settled: "true" },
            }),
            pageRebateHistory(cookie, { settled: "true" }),
        ]);
        const byDay = new Map<string, number>();
        for (const r of hist) {
            const day = ymdIst(new Date(r.createdAt));
            byDay.set(day, (byDay.get(day) ?? 0) + n(r.amount));
        }
        const rows = (totals.json?.data ?? []) as Array<{
            date: string;
            total: number;
        }>;
        expect(n(rows.find((r) => r.date === yest)?.total)).toBe(
            byDay.get(yest) ?? 0
        );
        expect(n(rows.find((r) => r.date === older)?.total)).toBe(
            byDay.get(older) ?? 0
        );
        expect(rows.find((r) => r.date === today)).toBeUndefined();
        expect(byDay.get(today)).toBeUndefined();
    });
});
