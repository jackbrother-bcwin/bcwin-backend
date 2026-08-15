/**
 * Deep edge-case test suite for L1 to L6 Multi-Level Team Rebate Commission Generation.
 *
 * Verifies:
 * 1. Full 6-tier referral chain (Root -> L1 -> L2 -> L3 -> L4 -> L5 -> L6)
 *    - Downline at L6 places a bet -> Root Upline gets L6 rebate, L5 gets L1, L4 gets L2, etc.
 *    - Intermediate layers get correct layer numbers.
 * 2. L1 downline bet → Root gets L1 rebate with exact rate match against RebateRateConfig.
 * 3. Deep Chain Boundary (> 6 levels):
 *    - Downline at L7 places a bet -> Root Upline (7 levels up) does NOT get a rebate (capped at 6 levels).
 *    - Node1..Node6 all get correct L6..L1 rebates.
 * 4. Real Bet Placement via HTTP APIs (Wingo, K3):
 *    - Placing an actual bet automatically generates L1..L6 team rebates for all uplines in real-time.
 *    - Robust polling with adequate timeout for async fire-and-forget rebate calc.
 * 5. Demo User Guard:
 *    - Demo bettor -> 0 team rebates created for any upline.
 * 6. VIP0 Upline Edge Case:
 *    - VIP0 uplines still receive rebate at VIP0 rates (nonzero for L1).
 * 7. Exact Rate Math Verification:
 *    - Verifies calculated rebate amounts match seed table rates exactly.
 * 8. Zero and Negative Bet Amounts:
 *    - Zero bet → 0 rebates. Negative bet → 0 rebates.
 * 9. Tiny Bet Amount (₹1):
 *    - Small fraction rebate calculates without crash, produces > 0 amount.
 * 10. Concurrent Multi-Layer Bets:
 *     - Simultaneous bets at L1..L6 calculate correctly without race conditions.
 * 11. Settlement Flow:
 *     - Unsettled rebates get settled, balance incremented, settled flag flipped.
 * 12. Complete Database Teardown Verification.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "@bcwin/db";
import { Cache } from "@bcwin/cache";
import {
    get,
    post,
    FixtureTracker,
    createTestUser,
    authCookieFor,
    cleanupByUserIds,
    ensureSystemConfig,
    createActiveWingoPeriod,
    createActiveK3Period,
} from "../helpers";
import { RebateCalculator } from "../../packages/rebate";

/** Lottery rate table from rebateRates.ts seed — VIP index = row index */
const LOTTERY_RATES: [number, number, number, number, number, number][] = [
    [0.5, 0.15, 0.0512, 0.0162, 0.00486, 0.001458],     // VIP0
    [0.6, 0.215, 0.06575, 0.025012, 0.010504, 0.003677], // VIP1
    [0.65, 0.22525, 0.085469, 0.035551, 0.010504, 0.003677], // VIP2
    [0.75, 0.28125, 0.105469, 0.0512, 0.02048, 0.008192],    // VIP3
    [0.8, 0.30125, 0.153531, 0.065251, 0.027732, 0.011786],  // VIP4
    [0.9, 0.405, 0.18225, 0.082013, 0.036906, 0.016608],     // VIP5
];

/**
 * Helper: poll Prisma for a rebate record with exponential backoff.
 * Returns the found record or null after exhausting retries.
 */
async function pollForRebate(
    filter: Parameters<typeof prisma.rebate.findFirst>[0],
    maxAttempts = 30,
    delayMs = 200,
): Promise<Awaited<ReturnType<typeof prisma.rebate.findFirst>>> {
    for (let i = 0; i < maxAttempts; i++) {
        const record = await prisma.rebate.findFirst(filter);
        if (record) return record;
        await new Promise((r) => setTimeout(r, delayMs));
    }
    return null;
}

describe("L1 to L6 Multi-Level Team Rebate Generation & Edge Cases", () => {
    const tracker = new FixtureTracker("l1l6");

    // Referral chain: Root -> Node1 (L1) -> Node2 (L2) -> Node3 (L3) -> Node4 (L4) -> Node5 (L5) -> Node6 (L6) -> Node7 (L7)
    let rootUser: any;
    let rootCookie: string;
    let node1: any;
    let node2: any;
    let node3: any;
    let node4: any;
    let node5: any;
    let node6: any;
    let node7: any;

    beforeAll(async () => {
        await ensureSystemConfig();

        // 1. Create Root User (VIP5 for high rebate rates across L1-L6)
        rootUser = await createTestUser(tracker, { balance: 50_000 });
        rootCookie = await authCookieFor(rootUser);
        await prisma.userVipLevel.upsert({
            where: { userId: rootUser.id },
            create: { userId: rootUser.id, currentLevel: 5, rebateLevel: 5, teamSize: 7, teamBetting: 0, teamDeposit: 0 },
            update: { currentLevel: 5, rebateLevel: 5 },
        });

        // 2. Node 1 (L1 of Root) — VIP3
        node1 = await createTestUser(tracker, { balance: 20_000, referredBy: rootUser.referralCode });
        await prisma.userVipLevel.upsert({
            where: { userId: node1.id },
            create: { userId: node1.id, currentLevel: 3, rebateLevel: 3, teamSize: 6, teamBetting: 0, teamDeposit: 0 },
            update: { currentLevel: 3, rebateLevel: 3 },
        });

        // 3. Node 2 (L2 of Root) — VIP2
        node2 = await createTestUser(tracker, { balance: 20_000, referredBy: node1.referralCode });
        await prisma.userVipLevel.upsert({
            where: { userId: node2.id },
            create: { userId: node2.id, currentLevel: 2, rebateLevel: 2, teamSize: 5, teamBetting: 0, teamDeposit: 0 },
            update: { currentLevel: 2, rebateLevel: 2 },
        });

        // 4. Node 3 (L3 of Root) — VIP1
        node3 = await createTestUser(tracker, { balance: 20_000, referredBy: node2.referralCode });
        await prisma.userVipLevel.upsert({
            where: { userId: node3.id },
            create: { userId: node3.id, currentLevel: 1, rebateLevel: 1, teamSize: 4, teamBetting: 0, teamDeposit: 0 },
            update: { currentLevel: 1, rebateLevel: 1 },
        });

        // 5. Node 4 (L4 of Root) — VIP0 (default, no explicit VIP set)
        node4 = await createTestUser(tracker, { balance: 20_000, referredBy: node3.referralCode });

        // 6. Node 5 (L5 of Root) — VIP0
        node5 = await createTestUser(tracker, { balance: 20_000, referredBy: node4.referralCode });

        // 7. Node 6 (L6 of Root) — VIP0
        node6 = await createTestUser(tracker, { balance: 20_000, referredBy: node5.referralCode });

        // 8. Node 7 (L7 of Root — beyond max 6 levels!)
        node7 = await createTestUser(tracker, { balance: 20_000, referredBy: node6.referralCode });
    });

    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
        });
    });

    // ── 1. Full 6-Tier Chain Verification ───────────────────────────────────

    describe("1. Full 6-Tier Chain Attribution (L1 to L6)", () => {
        test("Bet by L6 downline (Node 6) distributes rebate to ALL 6 uplines (Root, Node1..Node5)", async () => {
            const betAmount = 10_000;
            const betId = `l6-chain-test-${Date.now()}`;

            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: node6.id,
                betAmount,
                game: "WINGO",
                gameCategory: "LOTTERY",
                betId,
            });

            // Root User (VIP5) gets L6 rebate from Node 6
            const rootRebate = await prisma.rebate.findFirst({
                where: { userId: rootUser.id, fromUserId: node6.id, betId },
            });
            expect(rootRebate).not.toBeNull();
            expect(rootRebate!.layer).toBe(6);
            expect(rootRebate!.amount).toBeGreaterThan(0);
            expect(rootRebate!.betAmount).toBe(betAmount);
            expect(rootRebate!.receiverVip).toBe(5); // Root is VIP5
            expect(rootRebate!.game).toBe("WINGO");
            expect(rootRebate!.gameCategory).toBe("LOTTERY");
            expect(rootRebate!.settled).toBe(false);

            // Node 5 (VIP0) gets L1 rebate from Node 6
            const node5Rebate = await prisma.rebate.findFirst({
                where: { userId: node5.id, fromUserId: node6.id, betId },
            });
            expect(node5Rebate).not.toBeNull();
            expect(node5Rebate!.layer).toBe(1);

            // Node 4 (VIP0) gets L2 rebate
            const node4Rebate = await prisma.rebate.findFirst({
                where: { userId: node4.id, fromUserId: node6.id, betId },
            });
            expect(node4Rebate).not.toBeNull();
            expect(node4Rebate!.layer).toBe(2);

            // Node 3 (VIP1) gets L3 rebate
            const node3Rebate = await prisma.rebate.findFirst({
                where: { userId: node3.id, fromUserId: node6.id, betId },
            });
            expect(node3Rebate).not.toBeNull();
            expect(node3Rebate!.layer).toBe(3);

            // Node 2 (VIP2) gets L4 rebate
            const node2Rebate = await prisma.rebate.findFirst({
                where: { userId: node2.id, fromUserId: node6.id, betId },
            });
            expect(node2Rebate).not.toBeNull();
            expect(node2Rebate!.layer).toBe(4);

            // Node 1 (VIP3) gets L5 rebate
            const node1Rebate = await prisma.rebate.findFirst({
                where: { userId: node1.id, fromUserId: node6.id, betId },
            });
            expect(node1Rebate).not.toBeNull();
            expect(node1Rebate!.layer).toBe(5);

            // Verify exactly 6 rebate records total for this betId
            const allRebates = await prisma.rebate.findMany({
                where: { betId },
            });
            expect(allRebates.length).toBe(6);
        });

        test("Bet by L1 downline (Node 1) gives ONLY Root User L1 rebate, no other rebates", async () => {
            const betId = `l1-chain-test-${Date.now()}`;
            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: node1.id,
                betAmount: 5000,
                game: "WINGO",
                gameCategory: "LOTTERY",
                betId,
            });

            const rootRebate = await prisma.rebate.findFirst({
                where: { userId: rootUser.id, fromUserId: node1.id, betId },
            });
            expect(rootRebate).not.toBeNull();
            expect(rootRebate!.layer).toBe(1);
            expect(rootRebate!.amount).toBeGreaterThan(0);

            // Only 1 rebate should exist for this bet
            const allRebates = await prisma.rebate.findMany({ where: { betId } });
            expect(allRebates.length).toBe(1);
        });

        test("Intermediate bets: L3 downline (Node 3) distributes to Node2 (L1), Node1 (L2), Root (L3)", async () => {
            const betId = `l3-intermediate-${Date.now()}`;
            const betAmount = 8000;

            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: node3.id,
                betAmount,
                game: "K3",
                gameCategory: "LOTTERY",
                betId,
            });

            const allRebates = await prisma.rebate.findMany({
                where: { betId },
                orderBy: { layer: "asc" },
            });
            expect(allRebates.length).toBe(3);

            // Node 2 (VIP2) L1 from Node3
            const n2Rebate = allRebates.find((r) => r.userId === node2.id);
            expect(n2Rebate).toBeDefined();
            expect(n2Rebate!.layer).toBe(1);

            // Node 1 (VIP3) L2 from Node3
            const n1Rebate = allRebates.find((r) => r.userId === node1.id);
            expect(n1Rebate).toBeDefined();
            expect(n1Rebate!.layer).toBe(2);

            // Root (VIP5) L3 from Node3
            const rootRebate = allRebates.find((r) => r.userId === rootUser.id);
            expect(rootRebate).toBeDefined();
            expect(rootRebate!.layer).toBe(3);
        });
    });

    // ── 2. Exact Rate Math Verification ──────────────────────────────────────

    describe("2. Exact Rate Math Against RebateRateConfig Seed Table", () => {
        test("Root (VIP5) L1 rebate from Node1 bet matches LOTTERY VIP5 layer1 rate exactly", async () => {
            const betId = `rate-check-l1-${Date.now()}`;
            const betAmount = 10_000;

            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: node1.id,
                betAmount,
                game: "WINGO",
                gameCategory: "LOTTERY",
                betId,
            });

            const rootRebate = await prisma.rebate.findFirst({
                where: { userId: rootUser.id, fromUserId: node1.id, betId },
            });
            expect(rootRebate).not.toBeNull();

            const expectedRate = LOTTERY_RATES[5]![0]; // VIP5, layer1 = 0.9%
            const expectedAmount = betAmount * (expectedRate / 100);
            expect(rootRebate!.rate).toBe(expectedRate);
            expect(rootRebate!.amount).toBeCloseTo(expectedAmount, 4);
        });

        test("Node1 (VIP3) L1 rebate from Node2 bet matches LOTTERY VIP3 layer1 rate", async () => {
            const betId = `rate-check-n1-${Date.now()}`;
            const betAmount = 5000;

            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: node2.id,
                betAmount,
                game: "WINGO",
                gameCategory: "LOTTERY",
                betId,
            });

            const node1Rebate = await prisma.rebate.findFirst({
                where: { userId: node1.id, fromUserId: node2.id, betId },
            });
            expect(node1Rebate).not.toBeNull();

            const expectedRate = LOTTERY_RATES[3]![0]; // VIP3, layer1 = 0.75%
            const expectedAmount = betAmount * (expectedRate / 100);
            expect(node1Rebate!.rate).toBe(expectedRate);
            expect(node1Rebate!.amount).toBeCloseTo(expectedAmount, 4);
        });

        test("Root (VIP5) L6 rebate from Node6 matches LOTTERY VIP5 layer6 rate", async () => {
            const betId = `rate-check-l6-${Date.now()}`;
            const betAmount = 10_000;

            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: node6.id,
                betAmount,
                game: "WINGO",
                gameCategory: "LOTTERY",
                betId,
            });

            const rootRebate = await prisma.rebate.findFirst({
                where: { userId: rootUser.id, fromUserId: node6.id, betId },
            });
            expect(rootRebate).not.toBeNull();

            const expectedRate = LOTTERY_RATES[5]![5]; // VIP5, layer6 = 0.016608%
            const expectedAmount = betAmount * (expectedRate / 100);
            expect(rootRebate!.rate).toBe(expectedRate);
            expect(rootRebate!.amount).toBeCloseTo(expectedAmount, 4);
        });
    });

    // ── 3. Boundary Condition (> 6 Levels) ──────────────────────────────────

    describe("3. Chain Depth Limit Guard (> 6 Levels)", () => {
        test("Bet by L7 downline (Node 7) credits L1..L6 (Node6..Node1), but Root User (L7) gets 0 rebate", async () => {
            const betId = `l7-boundary-test-${Date.now()}`;
            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: node7.id,
                betAmount: 10_000,
                game: "WINGO",
                gameCategory: "LOTTERY",
                betId,
            });

            // Root User is 7 levels above Node 7 -> MUST NOT receive a rebate!
            const rootRebate = await prisma.rebate.findFirst({
                where: { userId: rootUser.id, fromUserId: node7.id, betId },
            });
            expect(rootRebate).toBeNull();

            // Node 1 (6 levels above Node 7) -> MUST receive L6 rebate
            const node1Rebate = await prisma.rebate.findFirst({
                where: { userId: node1.id, fromUserId: node7.id, betId },
            });
            expect(node1Rebate).not.toBeNull();
            expect(node1Rebate!.layer).toBe(6);

            // Node 6 (1 level above Node 7) -> MUST receive L1 rebate
            const node6Rebate = await prisma.rebate.findFirst({
                where: { userId: node6.id, fromUserId: node7.id, betId },
            });
            expect(node6Rebate).not.toBeNull();
            expect(node6Rebate!.layer).toBe(1);

            // Exactly 6 rebate records (not 7)
            const allRebates = await prisma.rebate.findMany({ where: { betId } });
            expect(allRebates.length).toBe(6);
        });
    });

    // ── 4. Real HTTP API Bet Placement Integration ───────────────────────────
    //
    // NOTE: The API's fire-and-forget `calculateRebateForBet` does NOT pass betId,
    // so rebate records have betId=null. We use a timestamp captured BEFORE the
    // HTTP call to filter out stale records from earlier tests in the same suite.

    describe("4. Real Bet Placement via HTTP API Endpoints", () => {
        test("Placing a real Wingo bet via POST /api/v1/wingo/bet generates team rebates automatically", async () => {
            const period = await createActiveWingoPeriod(tracker, 60);
            const bettorCookie = await authCookieFor(node2); // Node 2 is L2 to Root User

            const beforeBet = new Date();

            const res = await post("/api/v1/wingo/bet", {
                cookie: bettorCookie,
                json: {
                    periodId: period.id,
                    betType: "COLOR",
                    betChoice: "GREEN",
                    betAmount: 2000,
                },
            });

            expect(res.status === 201 || res.status === 200).toBe(true);
            expect(res.json?.success).toBe(true);

            // Poll for root rebate (node2 is L2 to Root)
            // Filter by createdAt >= beforeBet to avoid stale records from earlier tests
            const rootRebate = await pollForRebate({
                where: {
                    userId: rootUser.id,
                    fromUserId: node2.id,
                    game: "WINGO",
                    createdAt: { gte: beforeBet },
                },
                orderBy: { createdAt: "desc" },
            });

            expect(rootRebate).not.toBeNull();
            expect(rootRebate!.layer).toBe(2);
            expect(rootRebate!.betAmount).toBe(2000);
            expect(rootRebate!.amount).toBeGreaterThan(0);

            // Verify Node1 also got L1 rebate from node2's bet
            const node1Rebate = await pollForRebate({
                where: {
                    userId: node1.id,
                    fromUserId: node2.id,
                    game: "WINGO",
                    createdAt: { gte: beforeBet },
                },
                orderBy: { createdAt: "desc" },
            });
            expect(node1Rebate).not.toBeNull();
            expect(node1Rebate!.layer).toBe(1);
        });

        test("Placing a real K3 bet via POST /api/v1/k3/bet generates team rebates automatically", async () => {
            const period = await createActiveK3Period(tracker, 60);
            const bettorCookie = await authCookieFor(node3); // Node 3 is L3 to Root User

            const beforeBet = new Date();

            const res = await post("/api/v1/k3/bet", {
                cookie: bettorCookie,
                json: {
                    periodId: period.id,
                    betType: "SUM",
                    betChoice: "12",
                    betAmount: 3000,
                },
            });

            expect(res.status === 201 || res.status === 200).toBe(true);
            expect(res.json?.success).toBe(true);

            // Poll for root rebate (node3 is L3 to Root)
            const rootRebate = await pollForRebate({
                where: {
                    userId: rootUser.id,
                    fromUserId: node3.id,
                    game: "K3",
                    createdAt: { gte: beforeBet },
                },
                orderBy: { createdAt: "desc" },
            });

            expect(rootRebate).not.toBeNull();
            expect(rootRebate!.layer).toBe(3);
            expect(rootRebate!.betAmount).toBe(3000);

            // Verify intermediate uplines got their rebates too
            const node1Rebate = await pollForRebate({
                where: {
                    userId: node1.id,
                    fromUserId: node3.id,
                    game: "K3",
                    createdAt: { gte: beforeBet },
                },
                orderBy: { createdAt: "desc" },
            });
            expect(node1Rebate).not.toBeNull();
            expect(node1Rebate!.layer).toBe(2);

            const node2Rebate = await pollForRebate({
                where: {
                    userId: node2.id,
                    fromUserId: node3.id,
                    game: "K3",
                    createdAt: { gte: beforeBet },
                },
                orderBy: { createdAt: "desc" },
            });
            expect(node2Rebate).not.toBeNull();
            expect(node2Rebate!.layer).toBe(1);
        });
    });

    // ── 5. Demo User Edge Cases ──────────────────────────────────────────────

    describe("5. Demo User Edge Cases", () => {
        let demoBettor: any;

        beforeAll(async () => {
            // Create a Demo Bettor under Node 1
            demoBettor = await prisma.user.create({
                data: {
                    serialNumber: 999111 + Math.floor(Math.random() * 9000),
                    username: `demo_${Date.now()}`,
                    mobileNumber: `9199${Math.floor(Math.random() * 10000000)}`,
                    password: "hash",
                    referralCode: `REF_DEMO_${Date.now()}`,
                    referredBy: node1.referralCode,
                    isDemo: true,
                },
            });
            tracker.trackUser(demoBettor.id);
        });

        test("Demo bettor places bet -> 0 team rebates are generated for any upline", async () => {
            const betId = `demo-test-${Date.now()}`;
            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: demoBettor.id,
                betAmount: 10_000,
                game: "WINGO",
                gameCategory: "LOTTERY",
                betId,
            });

            const rebates = await prisma.rebate.findMany({
                where: { fromUserId: demoBettor.id },
            });
            expect(rebates.length).toBe(0);
        });

        test("Demo upline in chain is skipped but real uplines above still receive rebates", async () => {
            // Create chain: Root -> demoIntermediate -> realDownline
            const demoIntermediate = await prisma.user.create({
                data: {
                    serialNumber: 999222 + Math.floor(Math.random() * 9000),
                    username: `demo_mid_${Date.now()}`,
                    mobileNumber: `9198${Math.floor(Math.random() * 10000000)}`,
                    password: "hash",
                    referralCode: `REF_DM_${Date.now()}`,
                    referredBy: rootUser.referralCode,
                    isDemo: true,
                },
            });
            tracker.trackUser(demoIntermediate.id);

            const realDownline = await createTestUser(tracker, {
                balance: 10_000,
                referredBy: demoIntermediate.referralCode,
            });

            const betId = `demo-skip-${Date.now()}`;
            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: realDownline.id,
                betAmount: 5000,
                game: "WINGO",
                gameCategory: "LOTTERY",
                betId,
            });

            // Demo intermediate should be skipped (no rebate for demo user)
            const demoRebate = await prisma.rebate.findFirst({
                where: { userId: demoIntermediate.id, betId },
            });
            expect(demoRebate).toBeNull();

            // Root (2 levels up, but demo is skipped in layer count)
            // The getUplineChain walks up: realDownline -> demoIntermediate (L1) -> rootUser (L2)
            // At L1, demoIntermediate is isDemo so `continue` is called
            // At L2, rootUser is real so gets rebate
            const rootRebate = await prisma.rebate.findFirst({
                where: { userId: rootUser.id, betId },
            });
            expect(rootRebate).not.toBeNull();
            expect(rootRebate!.layer).toBe(2); // L2 because demo is in chain but skipped
            expect(rootRebate!.amount).toBeGreaterThan(0);
        });
    });

    // ── 6. VIP0 Upline Edge Case ────────────────────────────────────────────

    describe("6. VIP0 Upline Edge Cases", () => {
        test("VIP0 upline (Node4) receives rebate at VIP0 rates when their downline bets", async () => {
            const betId = `vip0-test-${Date.now()}`;
            const betAmount = 10_000;

            // Node5 bets -> Node4 (VIP0) gets L1 rebate at VIP0 rates
            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: node5.id,
                betAmount,
                game: "WINGO",
                gameCategory: "LOTTERY",
                betId,
            });

            const node4Rebate = await prisma.rebate.findFirst({
                where: { userId: node4.id, fromUserId: node5.id, betId },
            });
            expect(node4Rebate).not.toBeNull();
            expect(node4Rebate!.layer).toBe(1);
            expect(node4Rebate!.receiverVip).toBe(0); // VIP0

            // VIP0 L1 LOTTERY rate = 0.5%
            const expectedRate = LOTTERY_RATES[0]![0];
            expect(node4Rebate!.rate).toBe(expectedRate);
            expect(node4Rebate!.amount).toBeCloseTo(betAmount * (expectedRate / 100), 4);
        });
    });

    // ── 7. Small Fraction & Edge Math Verification ─────────────────────────────

    describe("7. Small Fraction & Extreme Math Edge Cases", () => {
        test("Tiny bet amount (₹1) with small fraction rate generates accurate decimal rebate without crashing", async () => {
            const betId = `tiny-math-${Date.now()}`;
            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: node1.id,
                betAmount: 1,
                game: "WINGO",
                gameCategory: "LOTTERY",
                betId,
            });

            const rootRebate = await prisma.rebate.findFirst({
                where: { userId: rootUser.id, fromUserId: node1.id, betId },
            });

            expect(rootRebate).not.toBeNull();
            expect(rootRebate!.amount).toBeGreaterThan(0);
            expect(typeof rootRebate!.amount).toBe("number");
            expect(Number.isFinite(rootRebate!.amount)).toBe(true);
            expect(Number.isNaN(rootRebate!.amount)).toBe(false);
        });

        test("Zero bet amount generates 0 rebates", async () => {
            const betId = `zero-bet-${Date.now()}`;
            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: node1.id,
                betAmount: 0,
                game: "WINGO",
                gameCategory: "LOTTERY",
                betId,
            });

            const rebates = await prisma.rebate.findMany({
                where: { betId },
            });
            expect(rebates.length).toBe(0);
        });

        test("Negative bet amount generates 0 rebates", async () => {
            const betId = `neg-bet-${Date.now()}`;
            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: node1.id,
                betAmount: -5000,
                game: "WINGO",
                gameCategory: "LOTTERY",
                betId,
            });

            const rebates = await prisma.rebate.findMany({
                where: { betId },
            });
            expect(rebates.length).toBe(0);
        });

        test("Very large bet amount calculates correctly without overflow", async () => {
            const betId = `huge-bet-${Date.now()}`;
            const betAmount = 10_000_000; // 1 Crore

            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: node1.id,
                betAmount,
                game: "WINGO",
                gameCategory: "LOTTERY",
                betId,
            });

            const rootRebate = await prisma.rebate.findFirst({
                where: { userId: rootUser.id, fromUserId: node1.id, betId },
            });
            expect(rootRebate).not.toBeNull();

            const expectedRate = LOTTERY_RATES[5]![0]; // VIP5, L1 = 0.9%
            const expectedAmount = betAmount * (expectedRate / 100);
            expect(rootRebate!.amount).toBeCloseTo(expectedAmount, 2);
            expect(Number.isFinite(rootRebate!.amount)).toBe(true);
        });
    });

    // ── 8. Bettor Without Any Upline ────────────────────────────────────────

    describe("8. Orphan Bettor (No Referral Chain)", () => {
        test("Bettor with no referredBy generates 0 team rebates", async () => {
            const orphan = await createTestUser(tracker, { balance: 5000 }); // no referredBy

            const betId = `orphan-bet-${Date.now()}`;
            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: orphan.id,
                betAmount: 5000,
                game: "WINGO",
                gameCategory: "LOTTERY",
                betId,
            });

            const rebates = await prisma.rebate.findMany({
                where: { betId },
            });
            expect(rebates.length).toBe(0);
        });
    });

    // ── 9. Non-existent Bettor ID ────────────────────────────────────────────

    describe("9. Invalid Bettor ID", () => {
        test("Non-existent bettorId does not crash and creates 0 rebates", async () => {
            const betId = `ghost-bet-${Date.now()}`;
            // Should not throw
            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: "00000000-0000-0000-0000-000000000000",
                betAmount: 1000,
                game: "WINGO",
                gameCategory: "LOTTERY",
                betId,
            });

            const rebates = await prisma.rebate.findMany({
                where: { betId },
            });
            expect(rebates.length).toBe(0);
        });
    });

    // ── 10. Concurrent Multi-Layer Bets ───────────────────────────────────────

    describe("10. Concurrent Multi-Layer Bets Execution", () => {
        test("Simultaneous bets at L1, L2, L3, L4, L5, L6 calculate without race conditions", async () => {
            const runTag = `conc-${Date.now()}`;

            await Promise.all([
                RebateCalculator.calculateTeamRebateForBet({ bettorId: node1.id, betAmount: 1000, game: "WINGO", betId: `${runTag}-1` }),
                RebateCalculator.calculateTeamRebateForBet({ bettorId: node2.id, betAmount: 2000, game: "K3", betId: `${runTag}-2` }),
                RebateCalculator.calculateTeamRebateForBet({ bettorId: node3.id, betAmount: 3000, game: "5D", betId: `${runTag}-3` }),
                RebateCalculator.calculateTeamRebateForBet({ bettorId: node4.id, betAmount: 4000, game: "SLOTS_JDB", gameCategory: "SLOTS", betId: `${runTag}-4` }),
                RebateCalculator.calculateTeamRebateForBet({ bettorId: node5.id, betAmount: 5000, game: "EVO_CASINO", gameCategory: "CASINO", betId: `${runTag}-5` }),
                RebateCalculator.calculateTeamRebateForBet({ bettorId: node6.id, betAmount: 6000, game: "MOTO", betId: `${runTag}-6` }),
            ]);

            // Clear cache to read fresh history
            await Cache.del(`user:${rootUser.id}:rebate-history`);

            // Verify Root User has rebate entries corresponding to each concurrent bet
            const rootRebates = await prisma.rebate.findMany({
                where: { userId: rootUser.id, betId: { startsWith: runTag } },
            });

            expect(rootRebates.length).toBe(6);
            const layers = rootRebates.map((r) => r.layer).sort();
            expect(layers).toEqual([1, 2, 3, 4, 5, 6]);
        });
    });

    // ── 11. Settlement Flow ─────────────────────────────────────────────────

    describe("11. Settlement Flow Verification", () => {
        test("settleAllUnsettledRebates credits user balance and flips settled flag", async () => {
            const betId = `settle-flow-${Date.now()}`;
            const betAmount = 10_000;

            // Create a fresh unsettled rebate
            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: node1.id,
                betAmount,
                game: "WINGO",
                gameCategory: "LOTTERY",
                betId,
            });

            // Verify it's unsettled
            const unsettled = await prisma.rebate.findFirst({
                where: { userId: rootUser.id, fromUserId: node1.id, betId },
            });
            expect(unsettled).not.toBeNull();
            expect(unsettled!.settled).toBe(false);

            // Capture balance before settlement
            const userBefore = await prisma.user.findUnique({
                where: { id: rootUser.id },
                select: { balance: true },
            });

            // Settle
            await RebateCalculator.settleAllUnsettledRebates();

            // Verify settled flag is true
            const settled = await prisma.rebate.findFirst({
                where: { id: unsettled!.id },
            });
            expect(settled).not.toBeNull();
            expect(settled!.settled).toBe(true);

            // Verify balance increased
            const userAfter = await prisma.user.findUnique({
                where: { id: rootUser.id },
                select: { balance: true },
            });
            expect(userAfter!.balance).toBeGreaterThan(userBefore!.balance);
        });
    });

    // ── 12. Game Category Mapping ────────────────────────────────────────────

    describe("12. Game Category Mapping Edge Cases", () => {
        test("WINGO, K3, 5D, MOTO, TRXWINGO all map to LOTTERY category", async () => {
            const games = ["WINGO", "K3", "5D", "MOTO", "TRXWINGO"];
            for (const game of games) {
                const betId = `cat-${game}-${Date.now()}`;
                await RebateCalculator.calculateTeamRebateForBet({
                    bettorId: node1.id,
                    betAmount: 1000,
                    game,
                    betId,
                });

                const rebate = await prisma.rebate.findFirst({
                    where: { userId: rootUser.id, betId },
                });
                expect(rebate).not.toBeNull();
                expect(rebate!.gameCategory).toBe("LOTTERY");
                expect(rebate!.game).toBe(game);
            }
        });

        test("Explicit gameCategory override takes precedence over auto-mapping", async () => {
            const betId = `cat-override-${Date.now()}`;
            await RebateCalculator.calculateTeamRebateForBet({
                bettorId: node1.id,
                betAmount: 1000,
                game: "WINGO",
                gameCategory: "CASINO", // Override — normally WINGO = LOTTERY
                betId,
            });

            const rebate = await prisma.rebate.findFirst({
                where: { userId: rootUser.id, betId },
            });
            expect(rebate).not.toBeNull();
            expect(rebate!.gameCategory).toBe("CASINO");
        });
    });

    // ── 13. Complete Database Teardown Verification ───────────────────────────

    describe("13. Complete Database Teardown Verification", () => {
        test("Purges all test users, periods, bets, and rebate records cleanly", async () => {
            const userCountBefore = tracker.userIds.length;
            expect(userCountBefore).toBeGreaterThan(0);

            await cleanupByUserIds(tracker.userIds, {
                periodPrefix: tracker.periodPrefix,
            });

            const usersAfter = await prisma.user.count({
                where: { id: { in: tracker.userIds } },
            });
            expect(usersAfter).toBe(0);

            const rebatesAfter = await prisma.rebate.count({
                where: {
                    OR: [
                        { userId: { in: tracker.userIds } },
                        { fromUserId: { in: tracker.userIds } },
                    ],
                },
            });
            expect(rebatesAfter).toBe(0);

            console.log(
                `✅ Verified L1..L6 Test DB Cleanup: ${userCountBefore} users and all associated bets & rebates purged successfully.`
            );
        });
    });
});
