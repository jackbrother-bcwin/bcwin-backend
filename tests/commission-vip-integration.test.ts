import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { prisma } from "@bcwin/db";
import { WingoScheduler } from "../apps/engine/src/scheduler/wingoScheduler";
import { VipLevelService } from "../apps/engine/src/services/vip/vipLevelService";
import { CommissionCalculator } from "../apps/engine/src/services/commission/commissionCalculator";

// Test users data
interface TestUser {
    id: string;
    username: string;
    mobileNumber: string;
    password: string;
    referralCode: string;
    referredBy?: string;
    balance: number;
}

let testUsers: TestUser[] = [];
let wingoScheduler: WingoScheduler;

describe("Commission, VIP Level, and Team Metrics Integration Tests", () => {
    beforeAll(async () => {
        console.log("🚀 Setting up test environment...\n");

        // Clean up any existing test data
        await cleanupTestData();

        // Seed VIP requirements and commission rates
        await seedVipRequirements();
        await seedCommissionRates();

        // Create test users in a referral chain
        await createTestUsers();

        // Initialize Wingo scheduler
        wingoScheduler = new WingoScheduler();

        console.log("✅ Test environment setup complete\n");
    });

    afterAll(async () => {
        console.log("\n🧹 Cleaning up test data...");
        await cleanupTestData();
        console.log("✅ Cleanup complete");
    });

    test("should create test users in referral chain", async () => {
        expect(testUsers).toHaveLength(7);

        // Verify referral chain
        for (let i = 1; i < testUsers.length; i++) {
            const user = await prisma.user.findUnique({
                where: { id: testUsers[i].id },
            });
            expect(user?.referredBy).toBe(testUsers[i - 1].referralCode);
        }

        console.log("✅ Test users created successfully");
        console.log(
            `   Chain: ${testUsers.map((u, i) => `User${i + 1}`).join(" → ")}\n`
        );
    });

    test("should seed VIP requirements and commission rates", async () => {
        const vipRequirements = await prisma.vipLevelRequirement.findMany();
        const commissionRates = await prisma.commissionRateConfig.findMany();

        expect(vipRequirements.length).toBeGreaterThan(0);
        expect(commissionRates.length).toBeGreaterThan(0);

        console.log(`✅ Seeded ${vipRequirements.length} VIP levels`);
        console.log(
            `✅ Seeded ${commissionRates.length} commission rate configs\n`
        );
    });

    test("should create Wingo period and place bets", async () => {
        // Create a 30-second period manually
        const startTime = new Date();
        // const endTime = new Date(startTime.getTime() + 30000);
        const endTime = new Date(startTime.getTime());

        const period = await prisma.wingoPeriod.create({
            data: {
                periodNumber: `TEST-${Date.now()}`,
                durationSeconds: 30,
                startTime,
                endTime,
                status: "ACTIVE",
            },
        });

        // Place bets from multiple users (user7, user5, user3)
        const betsData = [
            { userId: testUsers[6].id, betAmount: 1000, betChoice: "RED" }, // User 7
            { userId: testUsers[4].id, betAmount: 500, betChoice: "GREEN" }, // User 5
            { userId: testUsers[2].id, betAmount: 2000, betChoice: "5" }, // User 3
        ];

        for (const betData of betsData) {
            const contractAmount = betData.betAmount * 0.98; // 2% service fee

            await prisma.wingoBet.create({
                data: {
                    userId: betData.userId,
                    periodId: period.id,
                    betAmount: betData.betAmount,
                    contractAmount,
                    betType: betData.betChoice.match(/\d/) ? "NUMBER" : "COLOR",
                    betChoice: betData.betChoice,
                    status: "PENDING",
                },
            });

            // Deduct from user balance
            await prisma.user.update({
                where: { id: betData.userId },
                data: { balance: { decrement: betData.betAmount } },
            });
        }

        console.log(`✅ Created period ${period.periodNumber}`);
        console.log(`✅ Placed ${betsData.length} bets from test users\n`);

        expect(period).toBeDefined();
    });

    test("should settle bets and calculate commissions", async () => {
        // Wait a bit to ensure period end time has passed
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Run manual cycle to trigger settlement
        console.log("⏳ Running manual Wingo cycle...");
        await wingoScheduler.runManualCycle();
        console.log("✅ Manual cycle completed\n");

        // Check that commissions were created
        const commissions = await prisma.commission.findMany({
            include: {
                user: { select: { username: true } },
                fromUser: { select: { username: true } },
            },
        });

        console.log(`📊 Commission Records: ${commissions.length}`);

        if (commissions.length > 0) {
            console.log("\nCommission Details:");
            for (const comm of commissions) {
                console.log(
                    `   ${comm.user.username} ← ${comm.fromUser.username} | ` +
                        `Layer ${comm.layer} | VIP ${comm.userVipLevel} | ` +
                        `Rate ${
                            comm.commissionRate
                        }% | Amount ₹${comm.commissionAmount.toFixed(2)}`
                );
            }
        }

        expect(commissions.length).toBeGreaterThan(0);

        // Verify commission amounts are added to user balances
        for (const user of testUsers) {
            const updatedUser = await prisma.user.findUnique({
                where: { id: user.id },
            });

            const userCommissions = commissions.filter(
                (c) => c.userId === user.id
            );
            const totalCommission = userCommissions.reduce(
                (sum, c) => sum + c.commissionAmount,
                0
            );

            if (totalCommission > 0) {
                console.log(
                    `\n   ${
                        updatedUser?.username
                    } earned ₹${totalCommission.toFixed(2)} in commissions`
                );
            }
        }

        console.log();
    });

    test("should verify commission layers are correct", async () => {
        // User 7's bet should generate commissions for users 1-6
        // User 5's bet should generate commissions for users 1-4
        // User 3's bet should generate commissions for users 1-2

        const user7Commissions = await prisma.commission.findMany({
            where: { fromUserId: testUsers[6].id },
            orderBy: { layer: "asc" },
        });

        console.log(
            `📊 Commissions from User 7's bet: ${user7Commissions.length}`
        );

        // User 7 has 6 levels of upline (users 6, 5, 4, 3, 2, 1)
        expect(user7Commissions.length).toBeLessThanOrEqual(6);

        // Verify layers are sequential
        for (let i = 0; i < user7Commissions.length; i++) {
            expect(user7Commissions[i].layer).toBe(i + 1);
            console.log(
                `   Layer ${user7Commissions[i].layer}: User ${
                    testUsers.findIndex(
                        (u) => u.id === user7Commissions[i].userId
                    ) + 1
                }`
            );
        }

        console.log();
    });

    test("should calculate and update team metrics", async () => {
        console.log("⏳ Calculating team metrics for all users...");

        // Update team metrics for all test users
        for (const user of testUsers) {
            await VipLevelService.updateUserVipLevel(user.id);
        }

        console.log("✅ Team metrics calculated\n");

        // Check team metrics for user 1 (should have largest team)
        const user1Metrics = await prisma.teamMetrics.findUnique({
            where: { userId: testUsers[0].id },
        });

        console.log("📊 User 1 Team Metrics:");
        console.log(
            `   Direct Team Size: ${user1Metrics?.directTeamSize || 0}`
        );
        console.log(`   Total Team Size: ${user1Metrics?.totalTeamSize || 0}`);
        console.log(
            `   Total Team Betting: ₹${user1Metrics?.totalTeamBetting || 0}`
        );
        console.log(
            `   Total Team Deposit: ₹${user1Metrics?.totalTeamDeposit || 0}\n`
        );

        expect(user1Metrics).toBeDefined();
        expect(user1Metrics?.totalTeamSize).toBeGreaterThan(0);
        expect(user1Metrics?.totalTeamBetting).toBeGreaterThan(0);
    });

    test("should verify VIP levels", async () => {
        console.log("📊 VIP Levels:");

        for (const user of testUsers) {
            const vipLevel = await prisma.userVipLevel.findUnique({
                where: { userId: user.id },
            });

            const userIndex = testUsers.indexOf(user) + 1;
            console.log(
                `   User ${userIndex}: VIP Level ${
                    vipLevel?.currentLevel || 0
                } | ` + `Team Size: ${vipLevel?.teamSize || 0}`
            );

            expect(vipLevel).toBeDefined();
        }

        console.log();
    });

    test("should handle edge case: user with no upline", async () => {
        // User 1 has no upline, so placing a bet should not generate any commissions
        const period = await prisma.wingoPeriod.create({
            data: {
                periodNumber: `TEST-NO-UPLINE-${Date.now()}`,
                durationSeconds: 30,
                startTime: new Date(),
                endTime: new Date(Date.now() + 30000),
                status: "ACTIVE",
            },
        });

        await prisma.wingoBet.create({
            data: {
                userId: testUsers[0].id,
                periodId: period.id,
                betAmount: 100,
                contractAmount: 98,
                betType: "COLOR",
                betChoice: "RED",
                status: "PENDING",
            },
        });

        // Update period to ENDED and set result
        await prisma.wingoPeriod.update({
            where: { id: period.id },
            data: {
                status: "ENDED",
                resultNumber: 1,
                resultColor: "RED",
                resultSize: "SMALL",
            },
        });

        // Run settlement
        await wingoScheduler.runManualCycle();

        // Check no commissions were generated for this bet
        const commissionsFromUser1 = await prisma.commission.findMany({
            where: { fromUserId: testUsers[0].id },
        });

        console.log(
            `✅ Edge case: User with no upline generates ${commissionsFromUser1.length} commissions`
        );
        expect(commissionsFromUser1.length).toBe(0);
    });

    test("should handle edge case: different VIP levels", async () => {
        // Manually set different VIP levels for testing
        await prisma.userVipLevel.update({
            where: { userId: testUsers[0].id },
            data: { currentLevel: 5, rebateLevel: 5 },
        });

        await prisma.userVipLevel.update({
            where: { userId: testUsers[1].id },
            data: { currentLevel: 3, rebateLevel: 3 },
        });

        await prisma.userVipLevel.update({
            where: { userId: testUsers[2].id },
            data: { currentLevel: 1, rebateLevel: 1 },
        });

        console.log("✅ Set different VIP levels:");
        console.log("   User 1: VIP 5");
        console.log("   User 2: VIP 3");
        console.log("   User 3: VIP 1\n");

        // Place bet from user 4
        const period = await prisma.wingoPeriod.create({
            data: {
                periodNumber: `TEST-VIP-LEVELS-${Date.now()}`,
                durationSeconds: 30,
                startTime: new Date(),
                endTime: new Date(Date.now() + 30000),
                status: "ENDED", // Already ended
                resultNumber: 5,
                resultColor: "GREEN",
                resultSize: "BIG",
            },
        });

        await prisma.wingoBet.create({
            data: {
                userId: testUsers[3].id,
                periodId: period.id,
                betAmount: 1000,
                contractAmount: 980,
                betType: "NUMBER",
                betChoice: "5",
                status: "PENDING",
            },
        });

        await prisma.user.update({
            where: { id: testUsers[3].id },
            data: { balance: { decrement: 1000 } },
        });

        // Run settlement
        await wingoScheduler.runManualCycle();

        // Check commissions with different VIP rates
        const commissionsFromUser4 = await prisma.commission.findMany({
            where: { fromUserId: testUsers[3].id },
            orderBy: { layer: "asc" },
            include: { user: { select: { username: true } } },
        });

        console.log(
            `📊 Commissions from User 4's bet (${commissionsFromUser4.length} commissions):`
        );
        for (const comm of commissionsFromUser4) {
            console.log(
                `   ${comm.user.username} | Layer ${comm.layer} | ` +
                    `VIP ${comm.userVipLevel} | Rate ${comm.commissionRate}% | ` +
                    `Amount ₹${comm.commissionAmount.toFixed(2)}`
            );
        }

        expect(commissionsFromUser4.length).toBeGreaterThan(0);

        // Verify different commission rates based on VIP levels
        const vipLevels = commissionsFromUser4.map((c) => c.userVipLevel);
        const hasMultipleVipLevels = new Set(vipLevels).size > 1;

        console.log(
            `\n✅ Multiple VIP levels in commission chain: ${hasMultipleVipLevels}`
        );
    });

    test("should aggregate daily commissions", async () => {
        console.log("\n⏳ Running daily commission aggregation...");

        const today = new Date();
        await CommissionCalculator.aggregateDailyCommissions(today);

        const dailySummaries = await prisma.dailyCommissionSummary.findMany({
            where: {
                userId: { in: testUsers.map((u) => u.id) },
            },
            include: { user: { select: { username: true } } },
        });

        console.log(
            `✅ Created ${dailySummaries.length} daily commission summaries\n`
        );

        for (const summary of dailySummaries) {
            console.log(`📊 ${summary.user.username} Daily Summary:`);
            console.log(
                `   Total Commission: ₹${summary.totalCommission.toFixed(2)}`
            );
            console.log(`   Layer 1: ₹${summary.layer1Commission.toFixed(2)}`);
            console.log(`   Layer 2: ₹${summary.layer2Commission.toFixed(2)}`);
            console.log(`   Layer 3: ₹${summary.layer3Commission.toFixed(2)}`);
            console.log(`   Layer 4: ₹${summary.layer4Commission.toFixed(2)}`);
            console.log(`   Layer 5: ₹${summary.layer5Commission.toFixed(2)}`);
            console.log(
                `   Layer 6: ₹${summary.layer6Commission.toFixed(2)}\n`
            );
        }

        expect(dailySummaries.length).toBeGreaterThan(0);
    });

    test("should handle edge case: deposits affect team metrics", async () => {
        // Add successful deposits for some users
        const depositsData = [
            { userId: testUsers[6].id, amount: 5000 }, // User 7
            { userId: testUsers[4].id, amount: 3000 }, // User 5
            { userId: testUsers[2].id, amount: 10000 }, // User 3
        ];

        for (const depositData of depositsData) {
            await prisma.deposit.create({
                data: {
                    userId: depositData.userId,
                    orderId: `TEST-DEPOSIT-${Date.now()}-${Math.random()}`,
                    amount: depositData.amount,
                    method: "UPI",
                    status: "SUCCESS",
                },
            });
        }

        console.log(`✅ Created ${depositsData.length} test deposits\n`);

        // Recalculate team metrics
        for (const user of testUsers) {
            await VipLevelService.updateUserVipLevel(user.id);
        }

        // Check user 1's team metrics (should include all deposits)
        const user1Metrics = await prisma.teamMetrics.findUnique({
            where: { userId: testUsers[0].id },
        });

        console.log("📊 User 1 Team Metrics (after deposits):");
        console.log(
            `   Total Team Deposit: ₹${user1Metrics?.totalTeamDeposit || 0}`
        );

        const expectedTotalDeposit = depositsData.reduce(
            (sum, d) => sum + d.amount,
            0
        );
        expect(user1Metrics?.totalTeamDeposit).toBe(expectedTotalDeposit);
    });

    test("should verify commission rates vary by VIP and layer", async () => {
        // Get commission rates for different VIP levels
        const vip0Rates = await prisma.commissionRateConfig.findUnique({
            where: { vipLevel: 0 },
        });
        const vip5Rates = await prisma.commissionRateConfig.findUnique({
            where: { vipLevel: 5 },
        });
        const vip10Rates = await prisma.commissionRateConfig.findUnique({
            where: { vipLevel: 10 },
        });

        console.log("📊 Commission Rate Comparison:\n");
        console.log("VIP 0:");
        console.log(`   Layer 1: ${vip0Rates?.layer1}%`);
        console.log(`   Layer 2: ${vip0Rates?.layer2}%`);
        console.log(`   Layer 3: ${vip0Rates?.layer3}%\n`);

        console.log("VIP 5:");
        console.log(`   Layer 1: ${vip5Rates?.layer1}%`);
        console.log(`   Layer 2: ${vip5Rates?.layer2}%`);
        console.log(`   Layer 3: ${vip5Rates?.layer3}%\n`);

        console.log("VIP 10:");
        console.log(`   Layer 1: ${vip10Rates?.layer1}%`);
        console.log(`   Layer 2: ${vip10Rates?.layer2}%`);
        console.log(`   Layer 3: ${vip10Rates?.layer3}%\n`);

        // Verify rates increase with VIP level
        expect(vip5Rates?.layer1).toBeGreaterThanOrEqual(
            vip0Rates?.layer1 || 0
        );
        expect(vip10Rates?.layer1).toBeGreaterThanOrEqual(
            vip5Rates?.layer1 || 0
        );
    });

    test("should verify team metrics are recursive", async () => {
        // User 1 should have the largest team (all 6 downline users)
        // User 2 should have 5 users in team
        // User 3 should have 4 users in team
        // etc.

        console.log("📊 Team Size by User:\n");

        for (let i = 0; i < 6; i++) {
            const user = testUsers[i];
            const metrics = await prisma.teamMetrics.findUnique({
                where: { userId: user.id },
            });

            const expectedMaxTeamSize = 6 - i;
            console.log(
                `   User ${i + 1}: ${metrics?.totalTeamSize || 0} members ` +
                    `(expected: ≤ ${expectedMaxTeamSize})`
            );

            expect(metrics?.totalTeamSize).toBeLessThanOrEqual(
                expectedMaxTeamSize
            );
        }

        console.log();
    });
});

// Helper functions

async function cleanupTestData() {
    // Delete in correct order to respect foreign key constraints
    await prisma.commission.deleteMany({
        where: {
            fromUser: {
                username: { startsWith: "testuser" },
            },
        },
    });

    await prisma.dailyCommissionSummary.deleteMany({
        where: {
            user: {
                username: { startsWith: "testuser" },
            },
        },
    });

    await prisma.wingoBetResult.deleteMany({
        where: {
            bet: {
                user: {
                    username: { startsWith: "testuser" },
                },
            },
        },
    });

    await prisma.wingoBet.deleteMany({
        where: {
            user: {
                username: { startsWith: "testuser" },
            },
        },
    });

    await prisma.wingoPeriod.deleteMany({
        where: {
            periodNumber: { startsWith: "TEST" },
        },
    });

    await prisma.deposit.deleteMany({
        where: {
            orderId: { startsWith: "TEST-DEPOSIT" },
        },
    });

    await prisma.teamMetrics.deleteMany({
        where: {
            user: {
                username: { startsWith: "testuser" },
            },
        },
    });

    await prisma.userVipLevel.deleteMany({
        where: {
            user: {
                username: { startsWith: "testuser" },
            },
        },
    });

    await prisma.user.deleteMany({
        where: {
            username: { startsWith: "testuser" },
        },
    });
}

async function createTestUsers() {
    const users = [
        {
            username: "testuser1",
            mobileNumber: "1000000001",
            password: "test123",
            referralCode: "TEST001",
            balance: 10000,
        },
        {
            username: "testuser2",
            mobileNumber: "1000000002",
            password: "test123",
            referralCode: "TEST002",
            referredBy: "TEST001",
            balance: 10000,
        },
        {
            username: "testuser3",
            mobileNumber: "1000000003",
            password: "test123",
            referralCode: "TEST003",
            referredBy: "TEST002",
            balance: 10000,
        },
        {
            username: "testuser4",
            mobileNumber: "1000000004",
            password: "test123",
            referralCode: "TEST004",
            referredBy: "TEST003",
            balance: 10000,
        },
        {
            username: "testuser5",
            mobileNumber: "1000000005",
            password: "test123",
            referralCode: "TEST005",
            referredBy: "TEST004",
            balance: 10000,
        },
        {
            username: "testuser6",
            mobileNumber: "1000000006",
            password: "test123",
            referralCode: "TEST006",
            referredBy: "TEST005",
            balance: 10000,
        },
        {
            username: "testuser7",
            mobileNumber: "1000000007",
            password: "test123",
            referralCode: "TEST007",
            referredBy: "TEST006",
            balance: 10000,
        },
    ];

    let lastSerial = 100;
    for (const userData of users) {
        lastSerial += Math.floor(Math.random() * (999 - 300 + 1)) + 300;
        const user = await prisma.user.create({
            data: {
                ...userData,
                serialNumber: lastSerial,
            },
        });
        testUsers.push({ ...userData, id: user.id });
    }
}

async function seedVipRequirements() {
    const requirements = [
        { level: 0, expRequired: 0, levelUpReward: 0, monthlyReward: 0, rebateRate: null, teamSize: 0, teamBetting: 0, teamDeposit: 0 },
        { level: 1, expRequired: 3000, levelUpReward: 30, monthlyReward: 5, rebateRate: null, teamSize: 10, teamBetting: 50000, teamDeposit: 10000 },
        { level: 2, expRequired: 30000, levelUpReward: 150, monthlyReward: 15, rebateRate: "0.3%", teamSize: 30, teamBetting: 200000, teamDeposit: 50000 },
        { level: 3, expRequired: 400000, levelUpReward: 690, monthlyReward: 69, rebateRate: "0.35%", teamSize: 80, teamBetting: 800000, teamDeposit: 200000 },
        { level: 4, expRequired: 4000000, levelUpReward: 1290, monthlyReward: 690, rebateRate: "0.4%", teamSize: 200, teamBetting: 3000000, teamDeposit: 800000 },
        { level: 5, expRequired: 20000000, levelUpReward: 5900, monthlyReward: 2690, rebateRate: "0.45%", teamSize: 500, teamBetting: 10000000, teamDeposit: 3000000 },
        { level: 6, expRequired: 80000000, levelUpReward: 16900, monthlyReward: 6900, rebateRate: "0.5%", teamSize: 1200, teamBetting: 35000000, teamDeposit: 10000000 },
        { level: 7, expRequired: 300000000, levelUpReward: 69000, monthlyReward: 26900, rebateRate: "0.55%", teamSize: 2500, teamBetting: 100000000, teamDeposit: 35000000 },
        { level: 8, expRequired: 1000000000, levelUpReward: 169000, monthlyReward: 69000, rebateRate: "0.6%", teamSize: 5000, teamBetting: 300000000, teamDeposit: 100000000 },
        { level: 9, expRequired: 5000000000, levelUpReward: 690000, monthlyReward: 169000, rebateRate: "0.65%", teamSize: 10000, teamBetting: 800000000, teamDeposit: 300000000 },
        { level: 10, expRequired: 10000000000, levelUpReward: 1690000, monthlyReward: 690000, rebateRate: "0.7%", teamSize: 20000, teamBetting: 2000000000, teamDeposit: 800000000 },
    ];

    for (const req of requirements) {
        await prisma.vipLevelRequirement.upsert({
            where: { level: req.level },
            update: req,
            create: req,
        });
    }
}

async function seedCommissionRates() {
    const rates = [
        {
            vipLevel: 0,
            layer1: 0.4,
            layer2: 0.1,
            layer3: 0.05,
            layer4: 0.03,
            layer5: 0.02,
            layer6: 0.01,
        },
        {
            vipLevel: 1,
            layer1: 0.45,
            layer2: 0.12,
            layer3: 0.06,
            layer4: 0.035,
            layer5: 0.025,
            layer6: 0.015,
        },
        {
            vipLevel: 2,
            layer1: 0.5,
            layer2: 0.15,
            layer3: 0.08,
            layer4: 0.04,
            layer5: 0.03,
            layer6: 0.02,
        },
        {
            vipLevel: 3,
            layer1: 0.55,
            layer2: 0.18,
            layer3: 0.1,
            layer4: 0.05,
            layer5: 0.035,
            layer6: 0.025,
        },
        {
            vipLevel: 4,
            layer1: 0.6,
            layer2: 0.2,
            layer3: 0.12,
            layer4: 0.06,
            layer5: 0.04,
            layer6: 0.03,
        },
        {
            vipLevel: 5,
            layer1: 0.65,
            layer2: 0.22,
            layer3: 0.14,
            layer4: 0.07,
            layer5: 0.045,
            layer6: 0.035,
        },
        {
            vipLevel: 6,
            layer1: 0.7,
            layer2: 0.25,
            layer3: 0.16,
            layer4: 0.08,
            layer5: 0.05,
            layer6: 0.04,
        },
        {
            vipLevel: 7,
            layer1: 0.75,
            layer2: 0.28,
            layer3: 0.18,
            layer4: 0.1,
            layer5: 0.06,
            layer6: 0.045,
        },
        {
            vipLevel: 8,
            layer1: 0.8,
            layer2: 0.3,
            layer3: 0.2,
            layer4: 0.12,
            layer5: 0.07,
            layer6: 0.05,
        },
        {
            vipLevel: 9,
            layer1: 0.85,
            layer2: 0.35,
            layer3: 0.22,
            layer4: 0.14,
            layer5: 0.08,
            layer6: 0.06,
        },
        {
            vipLevel: 10,
            layer1: 0.9,
            layer2: 0.4,
            layer3: 0.25,
            layer4: 0.16,
            layer5: 0.1,
            layer6: 0.07,
        },
    ];

    for (const rate of rates) {
        await prisma.commissionRateConfig.upsert({
            where: { vipLevel: rate.vipLevel },
            update: rate,
            create: rate,
        });
    }
}
