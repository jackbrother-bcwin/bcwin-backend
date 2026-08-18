/**
 * Frontend live-period selection + official host WS rules.
 * These are the client edges that hid the pre-created next slot and kept
 * the game socket off Next on production hosts.
 */
import { describe, test, expect } from "bun:test";
import {
    isLivePeriod,
    pickLivePeriod,
    type PeriodLike,
} from "../../../frontend/app/lib/period-live";
import {
    isOfficialWebHost,
    OFFICIAL_WEB_HOSTS,
    OFFICIAL_WS_URL,
} from "../../../frontend/app/lib/official-hosts";

function iso(offsetMs: number): string {
    return new Date(Date.now() + offsetMs).toISOString();
}

describe("pickLivePeriod / isLivePeriod", () => {
    test("rejects missing endTime, ENDED, RESOLVED, and future startTime", () => {
        expect(isLivePeriod(null)).toBe(false);
        expect(isLivePeriod({})).toBe(false);
        expect(
            isLivePeriod({
                status: "ACTIVE",
                startTime: iso(-5_000),
                endTime: iso(20_000),
            })
        ).toBe(true);
        expect(
            isLivePeriod({
                status: "ENDED",
                startTime: iso(-5_000),
                endTime: iso(20_000),
            })
        ).toBe(false);
        expect(
            isLivePeriod({
                status: "RESOLVED",
                startTime: iso(-5_000),
                endTime: iso(20_000),
            })
        ).toBe(false);
        expect(
            isLivePeriod({
                status: "ACTIVE",
                startTime: iso(8_000),
                endTime: iso(38_000),
            })
        ).toBe(false);
        expect(
            isLivePeriod({
                status: "ACTIVE",
                startTime: iso(-40_000),
                endTime: iso(-1_000),
            })
        ).toBe(false);
    });

    test("never falls back to an expired periods[0] or a pre-created next", () => {
        const expired: PeriodLike = {
            id: "old",
            status: "ENDED",
            startTime: iso(-60_000),
            endTime: iso(-1_000),
        };
        const next: PeriodLike = {
            id: "next",
            status: "ACTIVE",
            startTime: iso(10_000),
            endTime: iso(40_000),
        };
        const live: PeriodLike = {
            id: "live",
            status: "ACTIVE",
            startTime: iso(-5_000),
            endTime: iso(25_000),
        };

        expect(pickLivePeriod(expired, [expired, next])).toBeNull();
        expect(pickLivePeriod(next, [next, expired])).toBeNull();
        expect(pickLivePeriod(next, [live, next])?.id).toBe("live");
        expect(pickLivePeriod(live, [expired, next])?.id).toBe("live");
        expect(pickLivePeriod(null, [expired, live, next])?.id).toBe("live");
    });

    test("prefers currentPeriod when it is actually live", () => {
        const a: PeriodLike = {
            id: "a",
            status: "ACTIVE",
            startTime: iso(-10_000),
            endTime: iso(20_000),
        };
        const b: PeriodLike = {
            id: "b",
            status: "ACTIVE",
            startTime: iso(-4_000),
            endTime: iso(26_000),
        };
        expect(pickLivePeriod(a, [b, a])?.id).toBe("a");
    });
});

describe("official hosts / game WS", () => {
    test("exactly the six verify hosts, www-stripped, no substring match", () => {
        expect(OFFICIAL_WEB_HOSTS).toEqual([
            "bcwin.club",
            "bcwin7.site",
            "bcwin7.live",
            "bcwin.click",
            "bcwin7.xyz",
            "bcwin.best",
        ]);
        for (const h of OFFICIAL_WEB_HOSTS) {
            expect(isOfficialWebHost(h)).toBe(true);
            expect(isOfficialWebHost(`www.${h}`)).toBe(true);
            expect(isOfficialWebHost(h.toUpperCase())).toBe(true);
        }
        expect(isOfficialWebHost("api.bcwin.club")).toBe(false);
        expect(isOfficialWebHost("notbcwin.club")).toBe(false);
        expect(isOfficialWebHost("bcwin.club.evil.com")).toBe(false);
        expect(isOfficialWebHost("example.com")).toBe(false);
        expect(OFFICIAL_WS_URL).toBe("wss://api.bcwin.club/api/v1/ws");
    });
});
