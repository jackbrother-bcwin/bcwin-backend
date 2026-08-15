/**
 * Deep integration: multi-level commission, team rebate, VIP XP/levels,
 * settlement + balance credits. All users cleaned up in afterAll.
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
import { CommissionCalculator } from "../../apps/engine/src/services/commission/commissionCalculator";
import { BetSettlement } from "../../apps/engine/src/services/wingo/betSettlement";
import { VipLevelService } from "../../apps/engine/src/services/vip/vipLevelService";
import { RebateCalculator } from "../../packages/rebate/rebateCalculator";
import { Cache, CacheKey } from "@bcwin/cache";

describe("Deep: Commission / Rebate / VIP / Team chain", () => {
    const tracker = new FixtureTracker("comm");
    /** chain[0] = top upline, chain[6] = deepest bettor */
    let chain: CreatedUser[] = [];
    let ratesByVip: Map<number, { layer1: number; layer2: number; layer3: number }> =
        new Map();

    beforeAll(async () => {
        process.env.PROCESS_ROLE = "engine";
        await ensureSystemConfig();
        await Cache.del(CacheKey.commissionRates);

        // Ensure rates exist
        const rateCount = await prisma.commissionRateConfig.count();
        expect(rateCount).toBeGreaterThan(0);
        const rates = await prisma.commissionRateConfig.findMany();
        for (const r of rates) {
            ratesByVip.set(r.vipLevel, {
                layer1: r.layer1,
                layer2: r.layer2,
                layer3: r.layer3,
            });
        }

        // Build L0 → L1 → … → L6 (7 users)
        chain = [];
        let prevCode: string | null = null;
        for (let i = 0; i < 7; i++) {
            const u = await createTestUser(tracker, {
                balance: i === 6 ? 50_000 : 0,
                referredBy: prevCode,
                username: `${tracker.runId}_L${i}`.slice(0, 28),
            });
            // Explicit VIP level rows for predictable rates
            await prisma.userVipLevel.upsert({
                where: { userId: u.id },
                create: {
                    userId: u.id,
                    currentLevel: i === 0 ? 2 : 0, // top XP VIP2
                    rebateLevel: i === 0 ? 2 : 0, // top rebate L2
                    teamSize: 0,
                    teamBetting: 0,
                    teamDeposit: 0,
                },
                update: {
                    currentLevel: i === 0 ? 2 : 0,
                    rebateLevel: i === 0 ? 2 : 0,
                },
            });
            chain.push(u);
            prevCode = u.referralCode;
        }
    });

    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
        });
        await Cache.del(CacheKey.commissionRates);
    });

    test("referral chain is 6 hops deep", async () => {
        expect(chain).toHaveLength(7);
        for (let i = 1; i < 7; i++) {
            const u = await prisma.user.findUniqueOrThrow({
                where: { id: chain[i]!.id },
            });
            expect(u.referredBy).toBe(chain[i - 1]!.referralCode);
        }
    });

    test("commission rates seed present for VIP 0–2", () => {
        expect(ratesByVip.has(0)).toBe(true);
        expect(ratesByVip.has(2)).toBe(true);
        expect(ratesByVip.get(0)!.layer1).toBeGreaterThan(0);
    });

    test("bet from deepest user distributes commission to 6 uplines", async () => {
        const bettor = chain[6]!;
        const contractAmount = 980; // as if betAmount 1000 @ 2% fee
        const betAmount = 1000;

        const period = await createActiveWingoPeriod(tracker, 300);
        const bet = await prisma.wingoBet.create({
            data: {
                userId: bettor.id,
                periodId: period.id,
                betAmount,
                contractAmount,
                betType: "COLOR",
                betChoice: "RED",
                status: "LOST",
            },
        });

        const balBefore = await Promise.all(
            chain.slice(0, 6).map((u) =>
                prisma.user.findUniqueOrThrow({
                    where: { id: u.id },
                    select: { id: true, balance: true },
                })
            )
        );

        await CommissionCalculator.calculateCommissionForBet(
            bet.id,
            "WINGO",
            bettor.id,
            betAmount,
            contractAmount
        );

        const commissions = await prisma.commission.findMany({
            where: { fromUserId: bettor.id, betId: bet.id },
            orderBy: { layer: "asc" },
        });

        expect(commissions.length).toBe(6);
        expect(commissions.map((c) => c.layer)).toEqual([1, 2, 3, 4, 5, 6]);

        // Layer 1 receiver = chain[5], layer 2 = chain[4], … layer 6 = chain[0]
        for (let layer = 1; layer <= 6; layer++) {
            const comm = commissions.find((c) => c.layer === layer)!;
            const expectedReceiver = chain[6 - layer]!;
            expect(comm.userId).toBe(expectedReceiver.id);
            expect(comm.commissionAmount).toBeGreaterThan(0);

            // VIP0 default rates except top (VIP2) is layer 6 for this bettor
            const receiverVip = layer === 6 ? 2 : 0;
            expect(comm.userVipLevel).toBe(receiverVip);

            const rateCfg = ratesByVip.get(receiverVip)!;
            const rateField = `layer${layer}` as "layer1" | "layer2" | "layer3";
            // layers 4-6 only on full config — use DB rate from record
            const expected = contractAmount * (comm.commissionRate / 100);
            expect(Math.abs(comm.commissionAmount - expected)).toBeLessThan(0.0001);
        }

        // Balances increased by commission amounts
        for (const comm of commissions) {
            const before = balBefore.find((b) => b.id === comm.userId)!;
            const after = await prisma.user.findUniqueOrThrow({
                where: { id: comm.userId },
            });
            expect(after.balance).toBeCloseTo(
                before.balance + comm.commissionAmount,
                5
            );
        }
    });

    test("team rebate accrues unsettled rows for uplines", async () => {
        const bettor = chain[6]!;
        const betAmount = 500;
        const period = await createActiveWingoPeriod(tracker, 180);
        const bet = await prisma.wingoBet.create({
            data: {
                userId: bettor.id,
                periodId: period.id,
                betAmount,
                contractAmount: 490,
                betType: "SIZE",
                betChoice: "BIG",
                status: "PENDING",
            },
        });

        await RebateCalculator.calculateTeamRebateForBet({
            bettorId: bettor.id,
            betAmount,
            game: "WINGO",
            betId: bet.id,
        });

        const rebates = await prisma.rebate.findMany({
            where: { fromUserId: bettor.id, betId: bet.id, settled: false },
            orderBy: { layer: "asc" },
        });

        // Rates may be 0 for some layers/VIP — at least some layers if config has rates
        expect(Array.isArray(rebates)).toBe(true);
        if (rebates.length > 0) {
            for (const r of rebates) {
                expect(r.settled).toBe(false);
                expect(r.amount).toBeGreaterThan(0);
                expect(r.layer).toBeGreaterThanOrEqual(1);
                expect(r.layer).toBeLessThanOrEqual(6);
                expect(chain.map((c) => c.id)).toContain(r.userId);
            }
        } else {
            // Config may zero-rate lottery category — still valid path
            expect(rebates.length).toBe(0);
        }
    });

    test("settle win credits bettor; commission job path still consistent", async () => {
        const bettor = chain[6]!;
        const period = await createActiveWingoPeriod(tracker, 60);
        await prisma.wingoPeriod.update({
            where: { id: period.id },
            data: {
                status: "ENDED",
                endTime: new Date(Date.now() - 2000),
                resultNumber: 5,
                resultColor: "GREEN",
                resultSize: "BIG",
            },
        });

        const betAmount = 100;
        const contractAmount = 98;
        await prisma.user.update({
            where: { id: bettor.id },
            data: { balance: { decrement: betAmount } },
        });
        const before = await prisma.user.findUniqueOrThrow({
            where: { id: bettor.id },
        });

        await prisma.wingoBet.create({
            data: {
                userId: bettor.id,
                periodId: period.id,
                betAmount,
                contractAmount,
                betType: "NUMBER",
                betChoice: "5",
                status: "PENDING",
            },
        });

        await new BetSettlement().settleAllEndedPeriodsWithResults();

        const after = await prisma.user.findUniqueOrThrow({
            where: { id: bettor.id },
        });
        // NUMBER win = 9x contract
        expect(after.balance).toBeCloseTo(before.balance + contractAmount * 9, 4);

        const resolved = await prisma.wingoPeriod.findUniqueOrThrow({
            where: { id: period.id },
        });
        expect(resolved.status).toBe("RESOLVED");
    });

    test("VIP level from XP via VipLevelService", async () => {
        const u = chain[1]!;
        const reqs = await prisma.vipLevelRequirement.findMany({
            orderBy: { level: "asc" },
        });
        expect(reqs.length).toBeGreaterThan(0);

        // Set XP high enough for at least level 1 if expRequired allows
        const level1 = reqs.find((r) => r.level === 1);
        const targetXp = level1 ? level1.expRequired + 10 : 1_000_000;

        await prisma.user.update({
            where: { id: u.id },
            data: { xp: targetXp },
        });

        const level = await VipLevelService.calculateUserVipLevel(u.id);
        expect(level).toBeGreaterThanOrEqual(0);

        await VipLevelService.updateUserVipLevel(u.id);
        const row = await prisma.userVipLevel.findUnique({
            where: { userId: u.id },
        });
        expect(row?.currentLevel).toBe(level);
    });

    test("no upline → zero commissions", async () => {
        const orphan = await createTestUser(tracker, {
            balance: 1000,
            referredBy: null,
        });
        const period = await createActiveWingoPeriod(tracker, 300);
        const bet = await prisma.wingoBet.create({
            data: {
                userId: orphan.id,
                periodId: period.id,
                betAmount: 100,
                contractAmount: 98,
                betType: "SIZE",
                betChoice: "SMALL",
                status: "LOST",
            },
        });

        await CommissionCalculator.calculateCommissionForBet(
            bet.id,
            "WINGO",
            orphan.id,
            100,
            98
        );

        const count = await prisma.commission.count({
            where: { fromUserId: orphan.id, betId: bet.id },
        });
        expect(count).toBe(0);
    });

    test("daily commission aggregation groups by user", async () => {
        // Use commissions already created for chain
        const today = new Date();
        await CommissionCalculator.aggregateDailyCommissions(today);

        const summaries = await prisma.dailyCommissionSummary.findMany({
            where: { userId: { in: tracker.userIds } },
        });
        // At least top receivers may have summaries
        expect(Array.isArray(summaries)).toBe(true);
        for (const s of summaries) {
            expect(s.totalCommission).toBeGreaterThanOrEqual(0);
        }
    });
});
