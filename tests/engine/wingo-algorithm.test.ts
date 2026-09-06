import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { SystemConfigCache, ResultSetter } from "@bcwin/cache";
import { SystemSettings } from "@bcwin/config";
import { prisma, type Config, type WingoBet, type WingoPeriod } from "@bcwin/db";
import { ResultGenerator } from "../../apps/engine/src/services/wingo/resultGenerator";
import * as tron from "../../apps/engine/src/services/trxwingo/tron";

// Only external boundaries are stubbed; exercise the real settings read and
// result selection without changing shared config, periods, or account balances.
describe("Wingo algorithm changes during a running period", () => {
    const restores: Array<() => void> = [];
    function track<T extends { mockRestore(): void }>(spy: T): T {
        restores.push(() => spy.mockRestore());
        return spy;
    }

    // Prisma delegates use proxies; assign through their setter rather than
    // spyOn (which defines a property that the proxy getter ignores).
    function mockDelegate(delegate: any, method: string) {
        const original = delegate[method];
        const replacement = mock();
        delegate[method] = replacement;
        restores.push(() => { delegate[method] = original; });
        return replacement;
    }

    afterEach(() => {
        for (const restore of restores.reverse()) restore();
        restores.length = 0;
    });

    function setup(initialAlgorithm: Config["wingoAlgorithm"] = "RANDOM") {
        const config = { wingoAlgorithm: initialAlgorithm } as Config;
        const period: WingoPeriod = {
            id: "algorithm-test-period",
            periodNumber: "209901010001",
            durationSeconds: 30,
            startTime: new Date(Date.now() - 20_000),
            endTime: new Date(Date.now() + 10_000),
            status: "ACTIVE",
            resultNumber: null,
            resultColor: null,
            resultSize: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const readConfig = mockDelegate(prisma.config, "findFirst")
            .mockImplementation(async () => ({ ...config }) as any);
        const cachedConfig = track(spyOn(SystemConfigCache, "getOrLoad"))
            .mockImplementation(async () => ({ ...config }));
        const readPeriod = mockDelegate(prisma.wingoPeriod, "findUnique")
            .mockResolvedValue(period);
        const writePeriod = mockDelegate(prisma.wingoPeriod, "update")
            .mockResolvedValue(period);
        const manual = track(spyOn(ResultSetter, "get")).mockResolvedValue(null);
        const deleteManual = track(spyOn(ResultSetter, "del")).mockResolvedValue();
        const bets = mockDelegate(prisma.wingoBet, "findMany")
            .mockResolvedValue([{
                periodId: period.id,
                betType: "SIZE",
                betChoice: "BIG",
                contractAmount: 100,
                betAmount: 100,
                status: "PENDING",
            } as WingoBet]);
        const block = track(spyOn(tron, "getLatestBlock")).mockResolvedValue({
            hash: "abc7def", number: 12, timestamp: Date.now(),
        });
        track(spyOn(Math, "random")).mockReturnValue(0);
        const generator = new ResultGenerator();
        const random = track(spyOn(generator, "generateResultNumber"))
            .mockReturnValue(9);
        return {
            config, period, readConfig, cachedConfig, readPeriod, writePeriod,
            manual, deleteManual, bets, block, generator, random,
        };
    }

    const transitions = [
        ["RANDOM", "WINNING", 0],
        ["RANDOM", "TRX", 7],
        ["WINNING", "RANDOM", 9],
        ["WINNING", "TRX", 7],
        ["TRX", "RANDOM", 9],
        ["TRX", "WINNING", 0],
    ] as const;

    test.each(transitions)("%s → %s applies to the current undrawn period", async (from, to, expected) => {
        const state = setup(from);
        expect(await SystemSettings.getWingoAlgorithm()).toBe(from);

        // Admin commits an update and refreshes Redis with 10s remaining.
        state.config.wingoAlgorithm = to;
        const result = await state.generator.processPeriodResult(state.period.id, {
            publish: false,
        });

        expect(result?.number).toBe(expected);
        expect(state.readConfig).not.toHaveBeenCalled();
        expect(state.cachedConfig).toHaveBeenCalledTimes(2);
        expect(state.writePeriod).toHaveBeenCalledWith({
            where: { id: state.period.id },
            data: {
                resultNumber: expected,
                resultColor: expected % 2 === 0 ? "RED" : "GREEN",
                resultSize: expected >= 5 ? "BIG" : "SMALL",
            },
        });
        expect(state.bets.mock.calls.length).toBe(to === "WINNING" ? 1 : 0);
        expect(state.block.mock.calls.length).toBe(to === "TRX" ? 1 : 0);
        expect(state.random.mock.calls.length).toBe(to === "RANDOM" ? 1 : 0);
    });

    test("an algorithm change does not replace an already drawn result", async () => {
        const state = setup();
        const first = await state.generator.processPeriodResult(state.period.id, { publish: false });
        state.readPeriod.mockResolvedValue({
            ...state.period,
            resultNumber: first!.number,
            resultColor: first!.color,
            resultSize: first!.size,
        });
        state.config.wingoAlgorithm = "WINNING";

        expect(await state.generator.processPeriodResult(state.period.id, { publish: false }))
            .toEqual(first);
        expect(state.readConfig).not.toHaveBeenCalled();
        expect(state.cachedConfig).toHaveBeenCalledTimes(1);
        expect(state.writePeriod).toHaveBeenCalledTimes(1);
        expect(state.bets).not.toHaveBeenCalled();
    });

    test("an algorithm change while TRX calculation is in flight does not switch its algorithm", async () => {
        const state = setup("TRX");
        const entered = Promise.withResolvers<void>();
        const pendingBlock = Promise.withResolvers<tron.LatestBlock>();
        state.block.mockImplementation(() => {
            entered.resolve();
            return pendingBlock.promise;
        });
        const drawing = state.generator.processPeriodResult(state.period.id, { publish: false });
        await entered.promise;
        state.config.wingoAlgorithm = "WINNING";
        pendingBlock.resolve({ hash: "abc7def", number: 12, timestamp: Date.now() });

        expect((await drawing)?.number).toBe(7);
        expect(state.readConfig).not.toHaveBeenCalled();
        expect(state.cachedConfig).toHaveBeenCalledTimes(1);
        expect(state.bets).not.toHaveBeenCalled();
    });

    test("manual results still take precedence over the algorithm", async () => {
        const state = setup("WINNING");
        state.manual.mockResolvedValue({ number: 0 });

        expect((await state.generator.processPeriodResult(state.period.id, { publish: false }))?.number)
            .toBe(0);
        expect(state.readConfig).not.toHaveBeenCalled();
        expect(state.deleteManual).toHaveBeenCalledWith("wingo", state.period.id);
    });

    test("a cache miss loads config from the database", async () => {
        const state = setup("WINNING");
        state.cachedConfig.mockImplementation(async (load) => load());

        expect((await state.generator.processPeriodResult(state.period.id, { publish: false }))?.number)
            .toBe(0);
        expect(state.readConfig).toHaveBeenCalledTimes(1);
    });
});
