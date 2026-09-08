import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@bcwin/db";
import { acceptTrxEntry, endTrxVisit, getTrxEntry, requireTrxVisit } from "../../apps/api/src/lib/trxEntry";
import { getUserWagerStatus } from "../../apps/api/src/lib/wagerEngine";
import { debitWithdrawal } from "../../apps/api/src/lib/withdrawalWager";
import { decodeJwt } from "../../apps/api/src/lib/auth";
import { FixtureTracker, createTestUser, createActiveWingoPeriod, cleanupByUserIds, ensureSystemConfig, authCookieFor, get, post } from "../helpers";
import { createActiveK3Period, createActiveFiveDPeriod, createActiveMotoPeriod, createActiveTrxWingoPeriod } from "../helpers";

describe("TRX consent and single-credit wagering", () => {
    const tracker = new FixtureTracker("trxentry");
    beforeAll(ensureSystemConfig);
    afterAll(() => cleanupByUserIds(tracker.userIds, { periodPrefix: tracker.periodPrefix }));
    const user = (balance = 1000) => createTestUser(tracker, { balance });
    const changeBalance = (id: string, balance: number) => prisma.user.update({ where: { id }, data: { balance } });
    const exit = (id: string, visitId?: string) => prisma.$transaction((tx) => endTrxVisit(tx, id, visitId));
    async function enter(id: string) {
        const quote = await getTrxEntry(id);
        if (!("quote" in quote)) throw new Error("Expected fresh quote");
        return acceptTrxEntry(id, quote.quote);
    }
    async function bet(userId: string, amount: number, createdAt = new Date()) {
        const period = await createActiveWingoPeriod(tracker);
        return prisma.wingoBet.create({ data: {
            userId, periodId: period.id, betAmount: amount, contractAmount: amount * .98,
            betType: "COLOR", betChoice: "GREEN", createdAt,
        } });
    }
    async function reward(userId: string, amount: number, createdAt: Date, wagerCleared = 0) {
        return prisma.wagerRequirement.create({ data: {
            userId, sourceType: "REWARD", amount, multiplier: 1, requiredWager: amount,
            createdAt, wagerCleared, isCleared: wagerCleared >= amount,
        } });
    }

    test("whole balance 5x is separate; active visits never reset; re-entry adds only the higher difference", async () => {
        const u = await user();
        const visit = await enter(u.id);
        expect((await getUserWagerStatus(u.id)).trxWagerNeeded).toBe(5000);
        await bet(u.id, 1000);
        expect((await getUserWagerStatus(u.id)).trxWagerNeeded).toBe(4000);
        await changeBalance(u.id, 1200);
        expect((await getTrxEntry(u.id)).visitId).toBe(visit.visitId);
        expect((await getUserWagerStatus(u.id)).trxWagerNeeded).toBe(4000);
        await exit(u.id, visit.visitId);
        const next = await enter(u.id);
        expect((await getUserWagerStatus(u.id)).trxWagerNeeded).toBe(6000);
        const receipt = await prisma.trxEntryConsent.findUniqueOrThrow({ where: { id: next.visitId } });
        expect(receipt.addedWager).toBe(2000);
        await exit(u.id);
        await changeBalance(u.id, 600);
        await enter(u.id);
        expect((await getUserWagerStatus(u.id)).trxWagerNeeded).toBe(6000);
    });

    test("quotes reject changed balance, tampering and other users; concurrent acceptance is idempotent", async () => {
        const u = await user();
        const quote = await getTrxEntry(u.id);
        if (!("quote" in quote)) throw new Error("Missing quote");
        await expect(decodeJwt(quote.quote)).rejects.toThrow();
        const other = await user();
        await expect(acceptTrxEntry(other.id, quote.quote)).rejects.toThrow();
        await expect(acceptTrxEntry(u.id, quote.quote + "x")).rejects.toThrow();
        await changeBalance(u.id, 1200);
        await expect(acceptTrxEntry(u.id, quote.quote)).rejects.toThrow("changed");
        expect(await prisma.trxEntryConsent.count({ where: { userId: u.id } })).toBe(0);
        const fresh = await getTrxEntry(u.id);
        if (!("quote" in fresh)) throw new Error("Missing quote");
        const results = await Promise.all([acceptTrxEntry(u.id, fresh.quote), acceptTrxEntry(u.id, fresh.quote)]);
        expect(results[0].visitId).toBe(results[1].visitId);
        expect(await prisma.trxEntryConsent.count({ where: { userId: u.id } })).toBe(1);
        expect((await getUserWagerStatus(u.id)).trxWagerNeeded).toBe(6000);
    });

    test("exit is account-wide, stale exits cannot close a new visit and old quotes cannot reopen", async () => {
        const u = await user();
        await expect(prisma.$transaction((tx) => requireTrxVisit(tx, u.id))).rejects.toThrow("Accept");
        const quote = await getTrxEntry(u.id);
        if (!("quote" in quote)) throw new Error("Missing quote");
        const old = await acceptTrxEntry(u.id, quote.quote);
        await prisma.$transaction((tx) => requireTrxVisit(tx, u.id));
        await exit(u.id, old.visitId);
        await expect(prisma.$transaction((tx) => requireTrxVisit(tx, u.id))).rejects.toThrow("Accept");
        await expect(acceptTrxEntry(u.id, quote.quote)).rejects.toThrow("changed");
        const next = await enter(u.id);
        await exit(u.id, old.visitId);
        expect((await getTrxEntry(u.id)).visitId).toBe(next.visitId);
    });

    test("FIFO credits each stake once across differently dated requirements and subsequent reads", async () => {
        const u = await user();
        const now = Date.now();
        const first = await reward(u.id, 100, new Date(now - 3000));
        const second = await reward(u.id, 100, new Date(now - 2000));
        await bet(u.id, 150, new Date(now - 1000));
        expect((await getUserWagerStatus(u.id)).rewardWagerNeeded).toBe(50);
        expect((await getUserWagerStatus(u.id)).rewardWagerNeeded).toBe(50);
        expect((await prisma.wagerRequirement.findUniqueOrThrow({ where: { id: first.id } })).wagerCleared).toBe(100);
        expect((await prisma.wagerRequirement.findUniqueOrThrow({ where: { id: second.id } })).wagerCleared).toBe(50);
        await enter(u.id);
        await bet(u.id, 100);
        const status = await getUserWagerStatus(u.id);
        expect(status.rewardWagerNeeded).toBe(0);
        expect(status.trxWagerNeeded).toBe(4950);
        expect((await getUserWagerStatus(u.id)).trxWagerNeeded).toBe(4950);
    });

    test("legacy credited progress remains credited without reusing its stake", async () => {
        const u = await user();
        const now = Date.now();
        await reward(u.id, 100, new Date(now - 4000), 100);
        await reward(u.id, 100, new Date(now - 3000), 100);
        await reward(u.id, 100, new Date(now - 2000));
        await bet(u.id, 100, new Date(now - 1000));
        expect((await getUserWagerStatus(u.id)).rewardWagerNeeded).toBe(100);
        expect((await getUserWagerStatus(u.id)).rewardWagerNeeded).toBe(100);
    });

    test("third-party bets do not reduce TRX, and clearing illegal penalty leaves TRX intact", async () => {
        const u = await user();
        await enter(u.id);
        await prisma.user.update({ where: { id: u.id }, data: { hasIllegalBetPenalty: true, illegalBetPenaltyFactor: 3 } });
        await prisma.inoutBet.create({ data: {
            userId: u.id, token: "trx-test", gameMode: "inout", betAmount: 5000,
            currency: "INR", operator: "test", transactionId: crypto.randomUUID(), gameId: "test", winAmount: 0,
        } });
        expect((await getUserWagerStatus(u.id)).trxWagerNeeded).toBe(5000);
        await prisma.user.update({ where: { id: u.id }, data: { hasIllegalBetPenalty: false, illegalBetPenaltyFactor: null } });
        expect((await getUserWagerStatus(u.id)).trxWagerNeeded).toBe(5000);
        await changeBalance(u.id, 5);
        expect((await getUserWagerStatus(u.id)).trxWagerNeeded).toBe(0);
    });

    test("zero wager hides TRX once; successful withdrawal ends visit and restores it even at zero balance", async () => {
        const u = await user();
        const visit = await enter(u.id);
        await prisma.user.update({ where: { id: u.id }, data: { zeroWagerEnabled: true } });
        expect((await getUserWagerStatus(u.id)).totalNeedToBet).toBe(0);
        await expect(prisma.$transaction(async (tx) => {
            await debitWithdrawal(tx, u.id, 1000, 10, new Date(0), new Date("2100-01-01"));
            throw new Error("rollback");
        })).rejects.toThrow("rollback");
        expect((await getTrxEntry(u.id)).visitId).toBe(visit.visitId);
        await prisma.$transaction((tx) => debitWithdrawal(tx, u.id, 1000, 10, new Date(0), new Date("2100-01-01")));
        const updated = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
        expect(updated.trxVisitId).toBeNull();
        expect(updated.zeroWagerEnabled).toBe(false);
        expect(updated.balance).toBe(0);
        expect((await getUserWagerStatus(u.id)).trxWagerNeeded).toBe(5000);
        await expect(prisma.$transaction((tx) => requireTrxVisit(tx, u.id))).rejects.toThrow();
    });

    test("all five first-party games clear TRX once", async () => {
        const u = await user();
        await enter(u.id);
        await bet(u.id, 100);
        const base = { userId: u.id, betAmount: 100, contractAmount: 98 };
        const k3 = await createActiveK3Period(tracker);
        await prisma.k3Bet.create({ data: { ...base, periodId: k3.id, betType: "BIG", betChoice: "BIG" } });
        const five = await createActiveFiveDPeriod(tracker);
        await prisma.fiveDBet.create({ data: { ...base, periodId: five.id, betType: "HIGH", betCategory: "POSITION", position: "A", betChoice: "HIGH" } });
        const moto = await createActiveMotoPeriod(tracker);
        await prisma.motoBet.create({ data: { ...base, periodId: moto.id, betType: "BIG_SMALL", targetPosition: "FIRST", betChoice: "big" } });
        const trx = await createActiveTrxWingoPeriod(tracker);
        await prisma.trxWingoBet.create({ data: { ...base, periodId: trx.id, betType: "COLOR", betChoice: "GREEN" } });
        expect((await getUserWagerStatus(u.id)).trxWagerNeeded).toBe(4500);
        expect((await getUserWagerStatus(u.id)).trxWagerNeeded).toBe(4500);
    });

    test("withdrawal API preserves visit on failure and closes it atomically on success", async () => {
        const u = await user();
        const visit = await enter(u.id);
        const cookie = await authCookieFor(u);
        await prisma.bank.create({ data: { userId: u.id, upiId: "trxentry@upi" } });
        await prisma.user.update({ where: { id: u.id }, data: { zeroWagerEnabled: true } });
        const failed = await post("/api/v1/payment/withdraw", { cookie, json: { amount: 300, method: "UPI", password: "wrong" } });
        expect(failed.status).toBe(400);
        expect((await getTrxEntry(u.id)).visitId).toBe(visit.visitId);
        const success = await post("/api/v1/payment/withdraw", { cookie, json: { amount: 300, method: "UPI", password: u.plainPassword } });
        expect(success.status).toBe(200);
        expect(await prisma.withdraw.count({ where: { userId: u.id } })).toBe(1);
        expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).trxVisitId).toBeNull();
        const info = await get("/api/v1/payment/withdraw/info", { cookie });
        expect(info.json.data.trxWagerNeeded).toBe(5000);
        expect(info.json.data.needToBet).toBe(5000);
        expect((await post("/api/v1/payment/withdraw", { cookie, json: { amount: 300, method: "UPI", password: u.plainPassword } })).status).toBe(400);
    });

    test("HTTP entry quotes, accepts, and is required before a TRX bet", async () => {
        const u = await user();
        const cookie = await authCookieFor(u);
        const quoted = await get("/api/v1/trxwingo/entry", { cookie });
        expect(quoted.status).toBe(200);
        expect(quoted.json.data.available).toBe(true);
        expect(quoted.json.data.active).toBe(false);
        expect(quoted.json.data.remainingAfter).toBe(5000);
        const rejected = await post("/api/v1/trxwingo/bet", {
            cookie,
            json: {
                periodId: (await createActiveTrxWingoPeriod(tracker)).id,
                betType: "COLOR",
                betChoice: "GREEN",
                betAmount: 10,
            },
        });
        expect(rejected.status).toBe(400);
        const accepted = await post("/api/v1/trxwingo/entry", {
            cookie,
            json: { quote: quoted.json.data.quote },
        });
        expect(accepted.status).toBe(200);
        expect(accepted.json.data.active).toBe(true);
        expect(await prisma.trxEntryConsent.count({ where: { userId: u.id } })).toBe(1);
        expect(await prisma.wagerRequirement.count({
            where: { userId: u.id, sourceType: "TRX_ENTRY" },
        })).toBe(1);
        const placed = await post("/api/v1/trxwingo/bet", {
            cookie,
            json: {
                periodId: (await createActiveTrxWingoPeriod(tracker)).id,
                betType: "COLOR",
                betChoice: "GREEN",
                betAmount: 10,
            },
        });
        expect(placed.status).toBe(201);
        expect((await getUserWagerStatus(u.id)).trxWagerNeeded).toBe(4990);
    });
});

