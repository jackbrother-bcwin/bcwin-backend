import { describe, test, expect } from "bun:test";
import {
    calculatePeriodTimes,
    generatePeriodNumber,
    betLockSeconds,
} from "../../apps/engine/src/services/utils";
import {
    betLockSeconds as apiBetLockSeconds,
    isPeriodBettingLocked,
} from "../../apps/api/src/lib/utils";

function ist(iso: string): Date {
    return new Date(iso);
}

function expectSlot(
    duration: number,
    atIso: string,
    startIso: string,
    endIso: string
) {
    const slot = calculatePeriodTimes(duration, ist(atIso));
    expect(slot.startTime.toISOString()).toBe(ist(startIso).toISOString());
    expect(slot.endTime.toISOString()).toBe(ist(endIso).toISOString());
    expect(slot.endTime.getTime() - slot.startTime.getTime()).toBe(
        duration * 1000
    );
}

describe("Win Go period slots", () => {
    test("lock window is 5s on 30s and 10s on longer (engine + API copies match)", () => {
        for (const n of [1, 30, 31, 60, 180, 300]) {
            expect(betLockSeconds(n)).toBe(apiBetLockSeconds(n));
        }
        expect(betLockSeconds(30)).toBe(5);
        expect(betLockSeconds(31)).toBe(10);
        expect(betLockSeconds(60)).toBe(10);
        expect(betLockSeconds(180)).toBe(10);
        expect(betLockSeconds(300)).toBe(10);
    });

    test("30s slots snap to :00 and :30, including last tick of the slot", () => {
        expectSlot(
            30,
            "2026-03-15T10:00:00.000+05:30",
            "2026-03-15T10:00:00.000+05:30",
            "2026-03-15T10:00:30.000+05:30"
        );
        expectSlot(
            30,
            "2026-03-15T10:00:25.000+05:30",
            "2026-03-15T10:00:00.000+05:30",
            "2026-03-15T10:00:30.000+05:30"
        );
        expectSlot(
            30,
            "2026-03-15T10:00:29.999+05:30",
            "2026-03-15T10:00:00.000+05:30",
            "2026-03-15T10:00:30.000+05:30"
        );
        expectSlot(
            30,
            "2026-03-15T10:00:30.000+05:30",
            "2026-03-15T10:00:30.000+05:30",
            "2026-03-15T10:01:00.000+05:30"
        );
        expectSlot(
            30,
            "2026-03-15T10:00:45.000+05:30",
            "2026-03-15T10:00:30.000+05:30",
            "2026-03-15T10:01:00.000+05:30"
        );
    });

    test("next 30s slot after endTime is the following :00/:30", () => {
        const at = ist("2026-03-15T10:00:25.000+05:30");
        const current = calculatePeriodTimes(30, at);
        const next = calculatePeriodTimes(30, current.endTime);
        expect(next.startTime.toISOString()).toBe(current.endTime.toISOString());
        expect(next.endTime.getTime() - next.startTime.getTime()).toBe(30_000);
        expect(generatePeriodNumber(30, current.endTime)).not.toBe(
            generatePeriodNumber(30, at)
        );
    });

    test("60s / 180s / 300s snap to minute blocks and stay contiguous", () => {
        expectSlot(
            60,
            "2026-03-15T10:00:25.000+05:30",
            "2026-03-15T10:00:00.000+05:30",
            "2026-03-15T10:01:00.000+05:30"
        );
        expectSlot(
            60,
            "2026-03-15T10:00:59.999+05:30",
            "2026-03-15T10:00:00.000+05:30",
            "2026-03-15T10:01:00.000+05:30"
        );
        expectSlot(
            180,
            "2026-03-15T10:04:10.000+05:30",
            "2026-03-15T10:03:00.000+05:30",
            "2026-03-15T10:06:00.000+05:30"
        );
        expectSlot(
            300,
            "2026-03-15T10:07:40.000+05:30",
            "2026-03-15T10:05:00.000+05:30",
            "2026-03-15T10:10:00.000+05:30"
        );

        for (const duration of [60, 180, 300] as const) {
            const current = calculatePeriodTimes(
                duration,
                ist("2026-03-15T10:07:40.000+05:30")
            );
            const next = calculatePeriodTimes(duration, current.endTime);
            expect(next.startTime.toISOString()).toBe(
                current.endTime.toISOString()
            );
            expect(generatePeriodNumber(duration, current.endTime)).not.toBe(
                generatePeriodNumber(duration, current.startTime)
            );
        }
    });

    test("IST midnight: last 30s of the day then 0001 on the next date", () => {
        const last = calculatePeriodTimes(
            30,
            ist("2026-03-15T23:59:45.000+05:30")
        );
        expect(last.startTime.toISOString()).toBe(
            ist("2026-03-15T23:59:30.000+05:30").toISOString()
        );
        expect(last.endTime.toISOString()).toBe(
            ist("2026-03-16T00:00:00.000+05:30").toISOString()
        );
        expect(generatePeriodNumber(30, last.startTime)).toBe("202603152880");

        const first = calculatePeriodTimes(30, last.endTime);
        expect(first.startTime.toISOString()).toBe(last.endTime.toISOString());
        const firstNum = generatePeriodNumber(30, last.endTime);
        expect(firstNum).toMatch(/^\d{12}$/);
        expect(firstNum.endsWith("0001")).toBe(true);
        expect(firstNum.startsWith("20260316")).toBe(true);
    });

    test("period numbers increment by 1 across a 30s boundary", () => {
        const a = generatePeriodNumber(30, ist("2026-03-15T10:00:00.000+05:30"));
        const b = generatePeriodNumber(30, ist("2026-03-15T10:00:30.000+05:30"));
        expect(a).toBe("202603151201");
        expect(b).toBe("202603151202");
    });
});

describe("isPeriodBettingLocked", () => {
    const start = ist("2026-03-15T10:00:00.000+05:30");
    const end30 = ist("2026-03-15T10:00:30.000+05:30");
    const end60 = ist("2026-03-15T10:01:00.000+05:30");

    test("locked before startTime (pre-created next slot)", () => {
        expect(
            isPeriodBettingLocked(
                { startTime: start, endTime: end30, durationSeconds: 30 },
                ist("2026-03-15T09:59:59.999+05:30")
            )
        ).toBe(true);
    });

    test("open in the middle of a live 30s and 60s period", () => {
        expect(
            isPeriodBettingLocked(
                { startTime: start, endTime: end30, durationSeconds: 30 },
                ist("2026-03-15T10:00:20.000+05:30")
            )
        ).toBe(false);
        expect(
            isPeriodBettingLocked(
                { startTime: start, endTime: end60, durationSeconds: 60 },
                ist("2026-03-15T10:00:45.000+05:30")
            )
        ).toBe(false);
    });

    test("30s lock starts exactly 5s before end; 60s lock starts 10s before end", () => {
        expect(
            isPeriodBettingLocked(
                { startTime: start, endTime: end30, durationSeconds: 30 },
                ist("2026-03-15T10:00:24.999+05:30")
            )
        ).toBe(false);
        expect(
            isPeriodBettingLocked(
                { startTime: start, endTime: end30, durationSeconds: 30 },
                ist("2026-03-15T10:00:25.000+05:30")
            )
        ).toBe(true);
        expect(
            isPeriodBettingLocked(
                { startTime: start, endTime: end60, durationSeconds: 60 },
                ist("2026-03-15T10:00:49.999+05:30")
            )
        ).toBe(false);
        expect(
            isPeriodBettingLocked(
                { startTime: start, endTime: end60, durationSeconds: 60 },
                ist("2026-03-15T10:00:50.000+05:30")
            )
        ).toBe(true);
    });

    test("locked at and after endTime", () => {
        expect(
            isPeriodBettingLocked(
                { startTime: start, endTime: end30, durationSeconds: 30 },
                end30
            )
        ).toBe(true);
        expect(
            isPeriodBettingLocked(
                { startTime: start, endTime: end30, durationSeconds: 30 },
                ist("2026-03-15T10:00:31.000+05:30")
            )
        ).toBe(true);
    });
});
