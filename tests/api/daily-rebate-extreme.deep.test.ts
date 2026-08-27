/**
 * Extreme daily Agent commission (ADR-0036 answers):
 * L0 at 00:00 → L1 once 10 new / ₹50k / ₹10k clear; live preview uses current
 * level; 24:00 prices the whole day at that final level; Inout catalog
 * category; leftover rows for someone else do not skip this upline; close
 * is idempotent.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@bcwin/db";
import {
    DailyTeamRebate,
    istDayRange,
    ymdIst,
} from "../../packages/rebate/dailyTeamRebate";
import { mapGameToRebateCategory } from "../../packages/rebate/gameCategory";
import {
    FixtureTracker,
    cleanupByUserIds,
    createTestUser,
    createWingoPeriod,
    ensureSystemConfig,
} from "../helpers";

const L0_LOTTERY_L1 = 0.5;
const L1_LOTTERY_L1 = 0.6;
const L1_LOTTERY_L2 = 0.215;
const L1_CASINO_L1 = 0.3;
const L1_SLOTS_L1 = 0.3;

function almost(a: number, b: number, eps = 0.02) {
    expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);
}

describe("Daily rebate EXTREME", () => {
    const tracker = new FixtureTracker("drex");
    const today = ymdIst();
    const range = istDayRange(today);
    const t = (h: number) => new Date(range.gte.getTime() + h * 3600_000);

    let G: Awaited<ReturnType<typeof createTestUser>>;
    let P: Awaited<ReturnType<typeof createTestUser>>;
    let l1s: Awaited<ReturnType<typeof createTestUser>>[] = [];
    let periodId: string;
    let casinoBetId: string;
    let slotsBetId: string;

    beforeAll(async () => {
        await ensureSystemConfig();
        G = await createTestUser(tracker, { balance: 0 });
        P = await createTestUser(tracker, {
            balance: 0,
            referredBy: G.referralCode,
        });
        await prisma.user.update({
            where: { id: P.id },
            data: { createdAt: new Date(range.gte.getTime() - 86400_000) },
        });
        const period = await createWingoPeriod(tracker, {
            startTime: new Date(),
        });
        periodId = period.id;

        await prisma.vipLevelRequirement.upsert({
            where: { level: 1 },
            create: {
                level: 1,
                expRequired: 1,
                teamSize: 10,
                teamBetting: 50_000,
                teamDeposit: 10_000,
            },
            update: {
                teamSize: 10,
                teamBetting: 50_000,
                teamDeposit: 10_000,
            },
        });
    });

    afterAll(async () => {
        await prisma.inoutBet.deleteMany({
            where: { userId: { in: tracker.userIds } },
        });
        await prisma.inoutGame.deleteMany({
            where: { gameMode: { startsWith: tracker.runId } },
        });
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
            giftCodePrefix: tracker.giftPrefix,
            orderIdPrefix: tracker.orderPrefix,
        });
    });

    test("mapGameToRebateCategory: live casino vs slots vs lottery", () => {
        expect(mapGameToRebateCategory("INOUT", "live casino")).toBe("CASINO");
        expect(mapGameToRebateCategory("INOUT", "slots")).toBe("SLOTS");
        expect(mapGameToRebateCategory("WINGO", null)).toBe("LOTTERY");
        expect(mapGameToRebateCategory("INOUT", null)).toBe("SLOTS");
    });

    test("before conditions: qualify 0 and preview uses L0 lottery %", async () => {
        const early = await createTestUser(tracker, {
            balance: 20_000,
            referredBy: P.referralCode,
        });
        await prisma.user.update({
            where: { id: early.id },
            data: { createdAt: t(1) },
        });
        await prisma.wingoBet.create({
            data: {
                userId: early.id,
                periodId,
                betAmount: 1000,
                contractAmount: 980,
                betType: "COLOR",
                betChoice: "RED",
                createdAt: t(1.5),
            },
        });
        const m = await DailyTeamRebate.metricsForDay(P.id, range);
        expect(m.teamSize).toBe(1);
        expect(await DailyTeamRebate.qualifyLevel(m)).toBe(0);
        const prev = await DailyTeamRebate.previewForUser(P.id, today);
        expect(prev.rebateLevel).toBe(0);
        almost(prev.totalCommission, 1000 * (L0_LOTTERY_L1 / 100));
    });

    test("after 10 new + ₹50k bet + ₹10k deposit: live preview is L1 %", async () => {
        for (let i = 0; i < 10; i++) {
            const u = await createTestUser(tracker, {
                balance: 20_000,
                referredBy: P.referralCode,
            });
            l1s.push(u);
            await prisma.user.update({
                where: { id: u.id },
                data: { createdAt: t(6) },
            });
            await prisma.deposit.create({
                data: {
                    orderId: `${tracker.orderPrefix}d${i}`,
                    amount: 1000,
                    method: "UPI",
                    status: "SUCCESS",
                    userId: u.id,
                    createdAt: t(6.2),
                },
            });
            await prisma.wingoBet.create({
                data: {
                    userId: u.id,
                    periodId,
                    betAmount: 5000,
                    contractAmount: 4900,
                    betType: "COLOR",
                    betChoice: "GREEN",
                    createdAt: t(6.5),
                },
            });
        }
        const m = await DailyTeamRebate.metricsForDay(P.id, range);
        expect(m.teamSize).toBe(11);
        expect(m.teamBetting).toBe(51_000);
        expect(m.teamDeposit).toBe(10_000);
        expect(await DailyTeamRebate.qualifyLevel(m)).toBeGreaterThanOrEqual(1);

        const prevP = await DailyTeamRebate.previewForUser(P.id, today);
        expect(prevP.rebateLevel).toBeGreaterThanOrEqual(1);
        almost(prevP.totalCommission, 51_000 * (L1_LOTTERY_L1 / 100));

        const prevG = await DailyTeamRebate.previewForUser(G.id, today);
        expect(prevG.rebateLevel).toBeGreaterThanOrEqual(1);
        almost(prevG.totalCommission, 51_000 * (L1_LOTTERY_L2 / 100));
    });

    test("Inout casino vs slots: catalog category, not blanket SLOTS", async () => {
        const casinoMode = `${tracker.runId}_live`;
        const slotsMode = `${tracker.runId}_slot`;
        await prisma.inoutGame.createMany({
            data: [
                {
                    title: "Live",
                    gameMode: casinoMode,
                    description: "t",
                    category: "live casino",
                    icon: "x",
                    multiplayer: false,
                    rtp: 96,
                },
                {
                    title: "Slots",
                    gameMode: slotsMode,
                    description: "t",
                    category: "slots",
                    icon: "x",
                    multiplayer: false,
                    rtp: 96,
                },
            ],
        });
        const bettor = l1s[0]!;
        const casino = await prisma.inoutBet.create({
            data: {
                userId: bettor.id,
                token: bettor.id,
                gameMode: casinoMode,
                betAmount: 2000,
                currency: "INR",
                operator: "t",
                transactionId: `${tracker.orderPrefix}cas`,
                gameId: "g-cas",
                winAmount: 0,
                createdAt: t(7),
            },
        });
        const slots = await prisma.inoutBet.create({
            data: {
                userId: bettor.id,
                token: bettor.id,
                gameMode: slotsMode,
                betAmount: 2000,
                currency: "INR",
                operator: "t",
                transactionId: `${tracker.orderPrefix}slt`,
                gameId: "g-slt",
                winAmount: 0,
                createdAt: t(7.1),
            },
        });
        casinoBetId = casino.id;
        slotsBetId = slots.id;

        const prev = await DailyTeamRebate.previewForUser(P.id, today);
        const extra =
            2000 * (L1_CASINO_L1 / 100) + 2000 * (L1_SLOTS_L1 / 100);
        almost(prev.totalCommission, 51_000 * (L1_LOTTERY_L1 / 100) + extra);
    });

    test("leftover settled row for another agent does not skip this upline", async () => {
        const stranger = await createTestUser(tracker, { balance: 0 });
        await prisma.rebate.create({
            data: {
                userId: stranger.id,
                fromUserId: l1s[0]!.id,
                amount: 1,
                game: "WINGO",
                gameCategory: "LOTTERY",
                layer: 1,
                receiverVip: 9,
                rate: 9,
                betAmount: 10,
                betId: "stranger-leftover",
                settled: true,
                createdAt: t(8),
            },
        });

        await prisma.userVipLevel.upsert({
            where: { userId: P.id },
            create: {
                userId: P.id,
                currentLevel: 0,
                rebateLevel: 4,
                teamSize: 0,
                teamBetting: 0,
                teamDeposit: 0,
            },
            update: { rebateLevel: 4 },
        });

        const before = Number(
            (await prisma.user.findUnique({ where: { id: P.id } }))
                ?.balance ?? 0
        );
        const r1 = await DailyTeamRebate.processClosedIstDay(today);
        expect(r1.created).toBeGreaterThan(0);

        const casinoRow = await prisma.rebate.findFirst({
            where: { userId: P.id, betId: casinoBetId },
        });
        const slotsRow = await prisma.rebate.findFirst({
            where: { userId: P.id, betId: slotsBetId },
        });
        expect(casinoRow?.gameCategory).toBe("CASINO");
        expect(slotsRow?.gameCategory).toBe("SLOTS");
        expect(casinoRow?.settled).toBe(true);
        expect(Number(casinoRow?.receiverVip)).toBeGreaterThanOrEqual(1);

        const after = Number(
            (await prisma.user.findUnique({ where: { id: P.id } }))
                ?.balance ?? 0
        );
        expect(after).toBeGreaterThan(before);

        const gAfter = Number(
            (await prisma.user.findUnique({ where: { id: G.id } }))
                ?.balance ?? 0
        );
        expect(gAfter).toBeGreaterThan(0);

        const r2 = await DailyTeamRebate.processClosedIstDay(today);
        expect(r2.created).toBe(0);
        const after2 = Number(
            (await prisma.user.findUnique({ where: { id: P.id } }))
                ?.balance ?? 0
        );
        expect(after2).toBe(after);

        const vip = await prisma.userVipLevel.findUnique({
            where: { userId: P.id },
        });
        expect(vip?.rebateLevel).toBe(0);
    });
});
