/**
 * Deep edge cases: rebate-only commission (ADR-0011).
 * - Accrue on place, settle at 01:30 IST job (manual settle here)
 * - No legacy commission from settlement path
 * - Demo skip, no upline, multi-layer, category, settle balance
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "@bcwin/db";
import {
    FixtureTracker,
    createTestUser,
    cleanupByUserIds,
    ensureSystemConfig,
    createActiveWingoPeriod,
    type CreatedUser,
} from "../helpers";
import { RebateCalculator } from "../../packages/rebate/rebateCalculator";
import { mapGameToRebateCategory } from "../../packages/rebate/gameCategory";
import { BetSettlement } from "../../apps/engine/src/services/wingo/betSettlement";
import { RebateScheduler } from "../../apps/engine/src/scheduler/rebateScheduler";

describe("Deep: rebate-only commission edge cases (ADR-0011)", () => {
    const tracker = new FixtureTracker("rebonly");
    let chain: CreatedUser[] = [];

    beforeAll(async () => {
        process.env.PROCESS_ROLE = "engine";
        await ensureSystemConfig();

        chain = [];
        let prev: string | null = null;
        for (let i = 0; i < 4; i++) {
            const u = await createTestUser(tracker, {
                balance: i === 3 ? 20_000 : 1_000,
                referredBy: prev,
                username: `${tracker.runId}_r${i}`.slice(0, 28),
            });
            await prisma.userVipLevel.upsert({
                where: { userId: u.id },
                create: {
                    userId: u.id,
                    currentLevel: 0, rebateLevel: 0,
                    teamSize: 0,
                    teamBetting: 0,
                    teamDeposit: 0,
                },
                update: { currentLevel: 0, rebateLevel: 0 },
            });
            chain.push(u);
            prev = u.referralCode;
        }
    });

    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
        });
    });

    test("mapGameToRebateCategory: lottery games", () => {
        expect(mapGameToRebateCategory("WINGO")).toBe("LOTTERY");
        expect(mapGameToRebateCategory("K3")).toBe("LOTTERY");
        expect(mapGameToRebateCategory("TRX-WINGO")).toBe("LOTTERY");
        expect(mapGameToRebateCategory("MOTO")).toBe("LOTTERY");
        expect(mapGameToRebateCategory("5D")).toBe("LOTTERY");
    });

    test("mapGameToRebateCategory: inout categories", () => {
        expect(mapGameToRebateCategory("INOUT", "slots")).toBe("SLOTS");
        expect(mapGameToRebateCategory("INOUT", "casino live")).toBe("CASINO");
        expect(mapGameToRebateCategory("INOUT", "sports")).toBe("SPORTS");
        expect(mapGameToRebateCategory("INOUT", "rummy")).toBe("RUMMY");
    });

    test("accrual creates unsettled rebates for L1–L3 (4-user chain)", async () => {
        const bettor = chain[3]!;
        const period = await createActiveWingoPeriod(tracker, 300);
        const bet = await prisma.wingoBet.create({
            data: {
                userId: bettor.id,
                periodId: period.id,
                betAmount: 1000,
                contractAmount: 980,
                betType: "COLOR",
                betChoice: "RED",
                status: "PENDING",
            },
        });

        await RebateCalculator.calculateTeamRebateForBet({
            bettorId: bettor.id,
            betAmount: 1000,
            game: "WINGO",
            betId: bet.id,
        });

        const rows = await prisma.rebate.findMany({
            where: { fromUserId: bettor.id, betId: bet.id },
            orderBy: { layer: "asc" },
        });

        expect(rows.length).toBe(3); // L1,L2,L3 parents
        expect(rows.every((r) => r.settled === false)).toBe(true);
        expect(rows.map((r) => r.layer)).toEqual([1, 2, 3]);
        expect(rows[0]!.userId).toBe(chain[2]!.id);
        expect(rows[1]!.userId).toBe(chain[1]!.id);
        expect(rows[2]!.userId).toBe(chain[0]!.id);

        // Amount based on betAmount not contract
        for (const r of rows) {
            expect(r.betAmount).toBe(1000);
            expect(r.amount).toBeGreaterThan(0);
            if (r.rate != null) {
                expect(r.amount).toBeCloseTo(1000 * (r.rate / 100), 5);
            }
        }
    });

    test("demo bettor generates no rebate", async () => {
        const demo = await createTestUser(tracker, {
            balance: 5000,
            referredBy: chain[0]!.referralCode,
        });
        await prisma.user.update({
            where: { id: demo.id },
            data: { isDemo: true },
        });

        await RebateCalculator.calculateTeamRebateForBet({
            bettorId: demo.id,
            betAmount: 500,
            game: "WINGO",
            betId: "demo-bet",
        });

        const n = await prisma.rebate.count({
            where: { fromUserId: demo.id },
        });
        expect(n).toBe(0);
    });

    test("no upline → no rebate rows", async () => {
        const orphan = await createTestUser(tracker, {
            balance: 1000,
            referredBy: null,
            username: `${tracker.runId}_orphan`.slice(0, 28),
        });
        // Ensure not accidentally linked
        await prisma.user.update({
            where: { id: orphan.id },
            data: { referredBy: null },
        });
        const check = await prisma.user.findUniqueOrThrow({
            where: { id: orphan.id },
        });
        expect(check.referredBy).toBeNull();

        await RebateCalculator.calculateTeamRebateForBet({
            bettorId: orphan.id,
            betAmount: 200,
            game: "K3",
            betId: `orphan-bet-${orphan.id}`,
        });
        expect(
            await prisma.rebate.count({ where: { fromUserId: orphan.id } })
        ).toBe(0);
    });

    test("settleAllUnsettledRebates credits balance once", async () => {
        const receiver = chain[2]!;
        const before = await prisma.user.findUniqueOrThrow({
            where: { id: receiver.id },
        });

        const unsettled = await prisma.rebate.findMany({
            where: { userId: receiver.id, settled: false },
        });
        const expectCredit = unsettled.reduce((s, r) => s + r.amount, 0);
        expect(expectCredit).toBeGreaterThan(0);

        await RebateCalculator.settleAllUnsettledRebates();

        const after = await prisma.user.findUniqueOrThrow({
            where: { id: receiver.id },
        });
        expect(after.balance).toBeCloseTo(before.balance + expectCredit, 4);

        const stillOpen = await prisma.rebate.count({
            where: { userId: receiver.id, settled: false },
        });
        expect(stillOpen).toBe(0);

        // Second settle is no-op
        const mid = after.balance;
        await RebateCalculator.settleAllUnsettledRebates();
        const after2 = await prisma.user.findUniqueOrThrow({
            where: { id: receiver.id },
        });
        expect(after2.balance).toBe(mid);
    });

    test("bet settlement does NOT create new legacy Commission rows", async () => {
        const bettor = chain[3]!;
        const period = await createActiveWingoPeriod(tracker, 60);
        await prisma.wingoPeriod.update({
            where: { id: period.id },
            data: {
                status: "ENDED",
                endTime: new Date(Date.now() - 1000),
                resultNumber: 1,
                resultColor: "GREEN",
                resultSize: "SMALL",
            },
        });

        await prisma.wingoBet.create({
            data: {
                userId: bettor.id,
                periodId: period.id,
                betAmount: 50,
                contractAmount: 49,
                betType: "NUMBER",
                betChoice: "9",
                status: "PENDING",
            },
        });

        const before = await prisma.commission.count({
            where: { fromUserId: bettor.id },
        });

        await new BetSettlement().settleAllEndedPeriodsWithResults();

        // Drain any accidental queue jobs is async; wait briefly
        await Bun.sleep(200);

        const after = await prisma.commission.count({
            where: { fromUserId: bettor.id },
        });
        expect(after).toBe(before);
    });

    test("RebateScheduler manual settlement works", async () => {
        // Accrue one more
        await RebateCalculator.calculateTeamRebateForBet({
            bettorId: chain[3]!.id,
            betAmount: 100,
            game: "WINGO",
            betId: `manual-${Date.now()}`,
        });
        const open = await prisma.rebate.count({
            where: { settled: false, userId: { in: tracker.userIds } },
        });
        expect(open).toBeGreaterThan(0);

        const sched = new RebateScheduler();
        await sched.runManualSettlement();

        const left = await prisma.rebate.count({
            where: { settled: false, userId: { in: tracker.userIds } },
        });
        expect(left).toBe(0);
    });

    test("zero / negative betAmount skipped", async () => {
        await RebateCalculator.calculateTeamRebateForBet({
            bettorId: chain[3]!.id,
            betAmount: 0,
            game: "WINGO",
            betId: "zero",
        });
        await RebateCalculator.calculateTeamRebateForBet({
            bettorId: chain[3]!.id,
            betAmount: -10,
            game: "WINGO",
            betId: "neg",
        });
        expect(
            await prisma.rebate.count({
                where: { betId: { in: ["zero", "neg"] } },
            })
        ).toBe(0);
    });
});
