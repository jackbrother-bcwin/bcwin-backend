import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "@bcwin/db";
import { createWagerRequirement, getUserWagerStatus, checkAndResetZeroBalanceWager } from "../../apps/api/src/lib/wagerEngine";

describe("Strict Bonus & Deposit Wager System Tests", () => {
    let testUserId: string;

    beforeAll(async () => {
        const rand = Math.floor(Math.random() * 1000000);
        const user = await prisma.user.create({
            data: {
                serialNumber: 99000 + Math.floor(Math.random() * 1000),
                username: `wagertest_${rand}`,
                mobileNumber: `99${rand.toString().padStart(8, "0")}`,
                password: "hashedpassword",
                referralCode: `WAGER${rand}`,
                balance: 1000,
            },
        });
        testUserId = user.id;
    });

    afterAll(async () => {
        if (testUserId) {
            await prisma.wagerRequirement.deleteMany({ where: { userId: testUserId } });
            await prisma.wingoBet.deleteMany({ where: { userId: testUserId } });
            await prisma.inoutBet.deleteMany({ where: { userId: testUserId } });
            await prisma.user.delete({ where: { id: testUserId } });
        }
    });

    test("1. Recharge deposit creates RECHARGE wager requirement", async () => {
        const req = await createWagerRequirement(prisma, testUserId, "RECHARGE", 100);
        expect(req).not.toBeNull();
        expect(req?.sourceType).toBe("RECHARGE");
        expect(req?.requiredWager).toBe(100);

        const status = await getUserWagerStatus(testUserId);
        expect(status.depositWagerNeeded).toBe(100);
        expect(status.rewardWagerNeeded).toBe(0);
        expect(status.totalNeedToBet).toBe(100);
        expect(status.isWithdrawalFrozen).toBe(true);
    });

    test("2. Wingo bet clears deposit wager requirement", async () => {
        const period = await prisma.wingoPeriod.create({
            data: {
                periodNumber: `P${Date.now()}`,
                durationSeconds: 60,
                startTime: new Date(),
                endTime: new Date(Date.now() + 60000),
            },
        });

        await prisma.wingoBet.create({
            data: {
                userId: testUserId,
                periodId: period.id,
                betAmount: 100,
                contractAmount: 98,
                betType: "COLOR" as any,
                betChoice: "RED",
            },
        });

        const status = await getUserWagerStatus(testUserId);
        expect(status.depositWagerNeeded).toBe(0);
        expect(status.totalNeedToBet).toBe(0);
        expect(status.isWithdrawalFrozen).toBe(false);
    });

    test("3. Reward claim creates REWARD wager requirement and bets before claim DO NOT clear it", async () => {
        // Pause 10ms to guarantee timestamp separation
        await new Promise((r) => setTimeout(r, 20));

        const req = await createWagerRequirement(prisma, testUserId, "REWARD", 50);
        expect(req).not.toBeNull();
        expect(req?.sourceType).toBe("REWARD");

        const status = await getUserWagerStatus(testUserId);
        // Previous 100 Wingo bet was placed BEFORE this reward claim, so it should NOT clear this 50 reward wager!
        expect(status.rewardWagerNeeded).toBe(50);
        expect(status.totalNeedToBet).toBe(50);
        expect(status.isWithdrawalFrozen).toBe(true);
    });

    test("4. Inout bets DO NOT clear wager requirement", async () => {
        await prisma.inoutBet.create({
            data: {
                userId: testUserId,
                token: "token123",
                gameMode: "inout",
                betAmount: 50,
                currency: "INR",
                operator: "op1",
                transactionId: `TX_${Date.now()}_${Math.random()}`,
                gameId: "g1",
                winAmount: 0,
            },
        });

        const status = await getUserWagerStatus(testUserId);
        // Inout bet does NOT clear wager, so 50 reward wager is still needed!
        expect(status.rewardWagerNeeded).toBe(50);
        expect(status.isWithdrawalFrozen).toBe(true);
    });

    test("5. Wingo bet after reward claim clears the reward wager", async () => {
        const period = await prisma.wingoPeriod.create({
            data: {
                periodNumber: `P2_${Date.now()}`,
                durationSeconds: 60,
                startTime: new Date(),
                endTime: new Date(Date.now() + 60000),
            },
        });

        await prisma.wingoBet.create({
            data: {
                userId: testUserId,
                periodId: period.id,
                betAmount: 50,
                contractAmount: 49,
                betType: "COLOR" as any,
                betChoice: "GREEN",
            },
        });

        const status = await getUserWagerStatus(testUserId);
        expect(status.rewardWagerNeeded).toBe(0);
        expect(status.totalNeedToBet).toBe(0);
        expect(status.isWithdrawalFrozen).toBe(false);
    });

    test("6. Zero balance resets pending reward wager requirements", async () => {
        // Add a new 100 reward wager requirement
        await createWagerRequirement(prisma, testUserId, "REWARD", 100);

        // Update user balance to 0 in database so getUserWagerStatus detects zero balance
        await prisma.user.update({
            where: { id: testUserId },
            data: { balance: 0 },
        });

        let statusAfter = await getUserWagerStatus(testUserId);
        expect(statusAfter.rewardWagerNeeded).toBe(0);
        expect(statusAfter.totalNeedToBet).toBe(0);
        expect(statusAfter.isWithdrawalFrozen).toBe(false);
    });
});
