/**
 * Win Go lock-window prepare / 00 handoff / background settle (ADR-0014).
 *
 * Isolated 2099 timestamps so getLivePeriod never collides with live slots.
 * Does not call WingoScheduler.runManualCycle() — that mutates current IST rows.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "@bcwin/db";
import {
    FixtureTracker,
    createTestUser,
    createWingoPeriod,
    cleanupByUserIds,
    ensureSystemConfig,
    type CreatedUser,
} from "../helpers";
import { PeriodManager } from "../../apps/engine/src/services/wingo/periodManager";
import { ResultGenerator } from "../../apps/engine/src/services/wingo/resultGenerator";
import { BetSettlement } from "../../apps/engine/src/services/wingo/betSettlement";
import {
    calculatePeriodTimes,
    generatePeriodNumber,
} from "../../apps/engine/src/services/utils";
import { GameLogic } from "../../apps/engine/src/services/wingo/gameLogic";

const SLOT_START = new Date("2099-06-01T12:00:00.000+05:30");
const SLOT_END = new Date("2099-06-01T12:00:30.000+05:30");
const LOCK_AT = new Date("2099-06-01T12:00:25.000+05:30");
const PRE_LOCK = new Date("2099-06-01T12:00:24.999+05:30");

function colorSize(n: number) {
    return {
        resultNumber: n,
        resultColor: (n % 2 === 0 ? "RED" : "GREEN") as "RED" | "GREEN",
        resultSize: (n >= 5 ? "BIG" : "SMALL") as "BIG" | "SMALL",
    };
}

describe("Deep: Win Go lock-window handoff", () => {
    const tracker = new FixtureTracker("wghand");
    const manager = new PeriodManager();
    const results = new ResultGenerator();
    const settlement = new BetSettlement();
    const extraIds: string[] = [];
    let user: CreatedUser;

    beforeAll(async () => {
        process.env.PROCESS_ROLE = "engine";
        await ensureSystemConfig();
        user = await createTestUser(tracker, { balance: 10_000 });
    });

    afterAll(async () => {
        if (extraIds.length) {
            await prisma.wingoBetResult.deleteMany({
                where: { periodId: { in: extraIds } },
            });
            await prisma.wingoBet.deleteMany({
                where: { periodId: { in: extraIds } },
            });
            await prisma.wingoPeriod.deleteMany({
                where: { id: { in: extraIds } },
            });
        }
        await prisma.wingoPeriod.deleteMany({
            where: {
                OR: [
                    { periodNumber: { startsWith: "20990601" } },
                    { periodNumber: { startsWith: "20990701" } },
                    { periodNumber: { startsWith: "20990801" } },
                ],
            },
        });
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
        });
    });

    test("getLivePeriod ignores future startTime and ended/resolved rows", async () => {
        const winStart = new Date("2099-07-01T12:00:00.000+05:30");
        const winEnd = new Date("2099-07-01T12:00:30.000+05:30");
        const winNextEnd = new Date("2099-07-01T12:01:00.000+05:30");
        const now = new Date("2099-07-01T12:00:10.000+05:30");

        const live = await createWingoPeriod(tracker, {
            durationSeconds: 30,
            startTime: winStart,
            endTime: winEnd,
            suffix: "live",
        });
        const next = await createWingoPeriod(tracker, {
            durationSeconds: 30,
            startTime: winEnd,
            endTime: winNextEnd,
            suffix: "next",
        });
        const ended = await createWingoPeriod(tracker, {
            durationSeconds: 30,
            startTime: new Date("2099-07-01T11:59:30.000+05:30"),
            endTime: winStart,
            status: "ENDED",
            suffix: "ended",
        });
        const resolved = await createWingoPeriod(tracker, {
            durationSeconds: 30,
            startTime: new Date("2099-07-01T11:59:00.000+05:30"),
            endTime: new Date("2099-07-01T11:59:30.000+05:30"),
            status: "RESOLVED",
            suffix: "res",
        });

        const found = await manager.getLivePeriod(30, now);
        expect(found?.id).toBe(live.id);

        const atHandoff = await manager.getLivePeriod(30, winEnd);
        expect(atHandoff?.id).toBe(next.id);

        const beforeStart = await manager.getLivePeriod(
            30,
            new Date(winStart.getTime() - 1)
        );
        expect(beforeStart?.id).not.toBe(live.id);
        expect([ended.id, resolved.id]).not.toContain(beforeStart?.id ?? "");
    });

    test("isInLockWindow is 5s on 30s and 10s on 60s", async () => {
        const p30 = await createWingoPeriod(tracker, {
            durationSeconds: 30,
            startTime: SLOT_START,
            endTime: SLOT_END,
            suffix: "lk30",
        });
        const p60 = await createWingoPeriod(tracker, {
            durationSeconds: 60,
            startTime: SLOT_START,
            endTime: new Date("2099-06-01T12:01:00.000+05:30"),
            suffix: "lk60",
        });

        expect(manager.isInLockWindow(p30, PRE_LOCK)).toBe(false);
        expect(manager.isInLockWindow(p30, LOCK_AT)).toBe(true);
        expect(manager.isInLockWindow(p30, SLOT_END)).toBe(true);

        expect(
            manager.isInLockWindow(
                p60,
                new Date("2099-06-01T12:00:49.999+05:30")
            )
        ).toBe(false);
        expect(
            manager.isInLockWindow(
                p60,
                new Date("2099-06-01T12:00:50.000+05:30")
            )
        ).toBe(true);
    });

    test("endExpiredPeriods only flips ACTIVE rows whose endTime has passed", async () => {
        const now = new Date();
        const due = await createWingoPeriod(tracker, {
            durationSeconds: 30,
            startTime: new Date(now.getTime() - 40_000),
            endTime: new Date(now.getTime() - 1_000),
            suffix: "due",
        });
        const stillLive = await createWingoPeriod(tracker, {
            durationSeconds: 30,
            startTime: now,
            endTime: new Date(now.getTime() + 60_000),
            suffix: "still",
        });

        const ended = await manager.endExpiredPeriods(now);
        const endedIds = ended.map((p) => p.id);
        expect(endedIds).toContain(due.id);
        expect(endedIds).not.toContain(stillLive.id);

        const dueRow = await prisma.wingoPeriod.findUniqueOrThrow({
            where: { id: due.id },
        });
        const liveRow = await prisma.wingoPeriod.findUniqueOrThrow({
            where: { id: stillLive.id },
        });
        expect(dueRow.status).toBe("ENDED");
        expect(liveRow.status).toBe("ACTIVE");
    });

    test("createPeriodIfNeeded is idempotent; ensureNextPeriod is not live until start", async () => {
        const at = new Date("2099-06-01T15:00:10.000+05:30");
        const first = await manager.createPeriodIfNeeded(30, at, {
            announce: false,
        });
        expect(first).not.toBeNull();
        extraIds.push(first!.id);

        const again = await manager.createPeriodIfNeeded(30, at, {
            announce: false,
        });
        expect(again?.id).toBe(first!.id);
        expect(again?.periodNumber).toBe(generatePeriodNumber(30, at));
        expect(again?.startTime.toISOString()).toBe(
            calculatePeriodTimes(30, at).startTime.toISOString()
        );

        const next = await manager.ensureNextPeriod(30, first!.endTime);
        expect(next).not.toBeNull();
        extraIds.push(next!.id);
        expect(next!.id).not.toBe(first!.id);
        expect(next!.startTime.toISOString()).toBe(first!.endTime.toISOString());

        const duringCurrent = await manager.getLivePeriod(30, at);
        expect(duringCurrent?.id).toBe(first!.id);
        expect(duringCurrent?.id).not.toBe(next!.id);

        const atNextStart = await manager.getLivePeriod(30, first!.endTime);
        expect(atNextStart?.id).toBe(next!.id);
    });

    test("prepare stores a result without redraw; second process keeps the same number", async () => {
        const period = await createWingoPeriod(tracker, {
            durationSeconds: 30,
            startTime: SLOT_START,
            endTime: SLOT_END,
            suffix: "draw",
        });

        const first = await results.processPeriodResult(period.id, {
            publish: false,
        });
        expect(first).not.toBeNull();
        expect(first!.number).toBeGreaterThanOrEqual(0);
        expect(first!.number).toBeLessThan(10);
        expect(first!.color).toBe(first!.number % 2 === 0 ? "RED" : "GREEN");
        expect(first!.size).toBe(first!.number >= 5 ? "BIG" : "SMALL");

        const stored = await prisma.wingoPeriod.findUniqueOrThrow({
            where: { id: period.id },
        });
        expect(stored.resultNumber).toBe(first!.number);
        expect(stored.status).toBe("ACTIVE");

        await prisma.wingoPeriod.update({
            where: { id: period.id },
            data: {
                resultNumber: 7,
                resultColor: "GREEN",
                resultSize: "BIG",
            },
        });
        const second = await results.processPeriodResult(period.id, {
            publish: false,
        });
        expect(second).toEqual({ number: 7, color: "GREEN", size: "BIG" });

        const after = await prisma.wingoPeriod.findUniqueOrThrow({
            where: { id: period.id },
        });
        expect(after.resultNumber).toBe(7);
        expect(after.resultColor).toBe("GREEN");
        expect(after.resultSize).toBe("BIG");
    });

    test("stored result is returned unchanged even when publish is requested after endTime", async () => {
        const period = await createWingoPeriod(tracker, {
            durationSeconds: 30,
            startTime: new Date("2099-06-01T11:00:00.000+05:30"),
            endTime: new Date("2099-06-01T11:00:30.000+05:30"),
            status: "ENDED",
            ...colorSize(4),
            suffix: "pub",
        });

        const drawn = await results.processPeriodResult(period.id, {
            publish: true,
        });
        expect(drawn).toEqual({ number: 4, color: "RED", size: "SMALL" });
    });

    test("settle pays PENDING bets during lock but does not RESOLVE while clock is live", async () => {
        const period = await createWingoPeriod(tracker, {
            durationSeconds: 30,
            startTime: new Date(),
            endTime: new Date(Date.now() + 20_000),
            ...colorSize(3),
            suffix: "paylive",
        });
        const bet = await prisma.wingoBet.create({
            data: {
                userId: user.id,
                periodId: period.id,
                betAmount: 100,
                contractAmount: 98,
                betType: "COLOR",
                betChoice: "GREEN",
                status: "PENDING",
            },
        });
        const balanceBefore = (
            await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
        ).balance;

        await settlement.settleAllEndedPeriodsWithResults();

        const paid = await prisma.wingoBet.findUniqueOrThrow({
            where: { id: bet.id },
        });
        const row = await prisma.wingoPeriod.findUniqueOrThrow({
            where: { id: period.id },
        });
        const after = await prisma.user.findUniqueOrThrow({
            where: { id: user.id },
        });
        const win = GameLogic.calculateWinAmount(paid, {
            number: 3,
            color: "GREEN",
            size: "SMALL",
        });

        expect(paid.status).toBe("WON");
        expect(win).toBe(196);
        expect(after.balance).toBeCloseTo(balanceBefore + 196, 6);
        expect(row.status).toBe("ACTIVE");

        await settlement.settleAllEndedPeriodsWithResults();
        const again = await prisma.user.findUniqueOrThrow({
            where: { id: user.id },
        });
        expect(again.balance).toBeCloseTo(after.balance, 6);
        expect(
            await prisma.wingoBetResult.count({ where: { betId: bet.id } })
        ).toBe(1);
    });

    test("settle marks RESOLVED only after endTime, and is idempotent", async () => {
        const period = await createWingoPeriod(tracker, {
            durationSeconds: 30,
            startTime: new Date(Date.now() - 40_000),
            endTime: new Date(Date.now() - 5_000),
            ...colorSize(8),
            suffix: "done",
        });
        await prisma.wingoBet.create({
            data: {
                userId: user.id,
                periodId: period.id,
                betAmount: 50,
                contractAmount: 49,
                betType: "SIZE",
                betChoice: "SMALL",
                status: "PENDING",
            },
        });

        await settlement.settleAllEndedPeriodsWithResults();
        const first = await prisma.wingoPeriod.findUniqueOrThrow({
            where: { id: period.id },
        });
        expect(first.status).toBe("RESOLVED");
        const lost = await prisma.wingoBet.findFirstOrThrow({
            where: { periodId: period.id },
        });
        expect(lost.status).toBe("LOST");

        await settlement.settleAllEndedPeriodsWithResults();
        const second = await prisma.wingoPeriod.findUniqueOrThrow({
            where: { id: period.id },
        });
        expect(second.status).toBe("RESOLVED");
        expect(
            await prisma.wingoBetResult.count({
                where: { periodId: period.id },
            })
        ).toBe(1);
    });

    test("two bets on one period settle independently (one WON, one LOST)", async () => {
        const period = await createWingoPeriod(tracker, {
            durationSeconds: 30,
            startTime: new Date(Date.now() - 40_000),
            endTime: new Date(Date.now() - 1_000),
            ...colorSize(2),
            suffix: "multi",
        });
        const [numBet, colorBet] = await Promise.all([
            prisma.wingoBet.create({
                data: {
                    userId: user.id,
                    periodId: period.id,
                    betAmount: 20,
                    contractAmount: 19.6,
                    betType: "NUMBER",
                    betChoice: "2",
                    status: "PENDING",
                },
            }),
            prisma.wingoBet.create({
                data: {
                    userId: user.id,
                    periodId: period.id,
                    betAmount: 20,
                    contractAmount: 19.6,
                    betType: "COLOR",
                    betChoice: "GREEN",
                    status: "PENDING",
                },
            }),
        ]);

        const balBefore = (
            await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
        ).balance;
        await settlement.settleAllEndedPeriodsWithResults();

        const won = await prisma.wingoBet.findUniqueOrThrow({
            where: { id: numBet.id },
        });
        const lost = await prisma.wingoBet.findUniqueOrThrow({
            where: { id: colorBet.id },
        });
        const balAfter = (
            await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
        ).balance;

        expect(won.status).toBe("WON");
        expect(lost.status).toBe("LOST");
        expect(balAfter).toBeCloseTo(balBefore + 19.6 * 9, 4);
    });

    test("full prepare → handoff → settle sequence on isolated rows", async () => {
        const seqStart = new Date("2099-08-01T12:00:00.000+05:30");
        const seqEnd = new Date("2099-08-01T12:00:30.000+05:30");
        const seqNextEnd = new Date("2099-08-01T12:01:00.000+05:30");
        const seqLock = new Date("2099-08-01T12:00:25.000+05:30");

        const live = await createWingoPeriod(tracker, {
            durationSeconds: 30,
            startTime: seqStart,
            endTime: seqEnd,
            suffix: "seqL",
        });
        const next = await createWingoPeriod(tracker, {
            durationSeconds: 30,
            startTime: seqEnd,
            endTime: seqNextEnd,
            suffix: "seqN",
        });
        await prisma.wingoBet.create({
            data: {
                userId: user.id,
                periodId: live.id,
                betAmount: 10,
                contractAmount: 9.8,
                betType: "SIZE",
                betChoice: "BIG",
                status: "PENDING",
            },
        });

        expect(manager.isInLockWindow(live, seqLock)).toBe(true);
        const drawn = await results.processPeriodResult(live.id, {
            publish: false,
        });
        expect(drawn).not.toBeNull();

        const duringLock = await prisma.wingoPeriod.findUniqueOrThrow({
            where: { id: live.id },
        });
        expect(duringLock.status).toBe("ACTIVE");
        expect(duringLock.resultNumber).toBe(drawn!.number);

        expect((await manager.getLivePeriod(30, seqLock))?.id).toBe(live.id);
        expect((await manager.getLivePeriod(30, seqLock))?.id).not.toBe(next.id);

        const ended = await prisma.wingoPeriod.update({
            where: { id: live.id },
            data: { status: "ENDED" },
        });
        expect(ended.status).toBe("ENDED");

        const published = await results.processPeriodResult(live.id, {
            publish: true,
        });
        expect(published?.number).toBe(drawn!.number);

        await prisma.wingoPeriod.update({
            where: { id: live.id },
            data: { endTime: new Date(Date.now() - 1000) },
        });
        await settlement.settleAllEndedPeriodsWithResults();

        const settledBet = await prisma.wingoBet.findFirstOrThrow({
            where: { periodId: live.id },
        });
        expect(["WON", "LOST"]).toContain(settledBet.status);
        expect((await manager.getLivePeriod(30, seqEnd))?.id).toBe(next.id);

        const finished = await prisma.wingoPeriod.findUniqueOrThrow({
            where: { id: live.id },
        });
        expect(finished.status).toBe("RESOLVED");
        expect(finished.resultNumber).toBe(drawn!.number);
        expect(
            await prisma.wingoBet.count({
                where: { periodId: live.id, status: "PENDING" },
            })
        ).toBe(0);
    });

    test("ResultGenerator color/size helpers match stored mapping 0-9", () => {
        for (let n = 0; n <= 9; n++) {
            expect(results.calculateResultColor(n)).toBe(
                n % 2 === 0 ? "RED" : "GREEN"
            );
            expect(results.calculateResultSize(n)).toBe(n >= 5 ? "BIG" : "SMALL");
            expect(results.isSpecialResult(n)).toBe(n === 0 || n === 5);
            expect(results.getSecondaryColor(n)).toBe(
                n === 0 || n === 5 ? "VIOLET" : null
            );
        }
    });
});
