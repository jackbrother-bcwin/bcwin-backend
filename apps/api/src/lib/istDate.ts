/**
 * India Standard Time (UTC+05:30) calendar helpers for commission / team stats.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Parse YYYY-MM-DD as IST midnight → UTC Date */
export function parseYmdStartIst(ymd: string): Date {
    return new Date(`${ymd}T00:00:00+05:30`);
}

/** Exclusive end of IST calendar day (next midnight IST) */
export function parseYmdEndExclusiveIst(ymd: string): Date {
    return new Date(parseYmdStartIst(ymd).getTime() + 24 * 60 * 60 * 1000);
}

/** Inclusive end of IST calendar day (23:59:59.999 IST) */
export function parseYmdEndInclusiveIst(ymd: string): Date {
    return new Date(parseYmdEndExclusiveIst(ymd).getTime() - 1);
}

/** Today's date string in IST as YYYY-MM-DD */
export function ymdIst(d = new Date()): string {
    const ist = new Date(d.getTime() + IST_OFFSET_MS);
    const y = ist.getUTCFullYear();
    const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
    const day = String(ist.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

/** Shift an IST YYYY-MM-DD by N calendar days */
export function shiftYmdIst(ymd: string, days: number): string {
    const start = parseYmdStartIst(ymd);
    return ymdIst(new Date(start.getTime() + days * 24 * 60 * 60 * 1000));
}

export function isValidYmd(ymd: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(ymd);
}

/** IST weekday: 0 = Sunday … 6 = Saturday */
export function istWeekdaySun0(d = new Date()): number {
    return new Date(d.getTime() + IST_OFFSET_MS).getUTCDay();
}

/** Monday of the IST week containing `d` (YYYY-MM-DD) */
export function mondayOfIstWeek(d = new Date()): string {
    const ymd = ymdIst(d);
    const dow = istWeekdaySun0(d);
    const monOffset = dow === 0 ? -6 : 1 - dow;
    return shiftYmdIst(ymd, monOffset);
}

function pad2(n: number): string {
    return String(n).padStart(2, "0");
}

/** Inclusive IST day bounds (start 00:00, end 23:59:59.999). */
export function istInclusiveDay(ymd: string): { start: Date; end: Date } {
    return {
        start: parseYmdStartIst(ymd),
        end: parseYmdEndInclusiveIst(ymd),
    };
}

/** Inclusive range from start YMD through end YMD (both IST calendar days). */
export function istInclusiveRange(
    startYmd: string,
    endYmd: string
): { start: Date; end: Date } {
    return {
        start: parseYmdStartIst(startYmd),
        end: parseYmdEndInclusiveIst(endYmd),
    };
}

/** First IST day of the month for a YYYY-MM-DD */
export function firstOfIstMonth(ymd: string): string {
    return `${ymd.slice(0, 7)}-01`;
}

export function prevIstMonthRange(ymd: string): { start: Date; end: Date } {
    const [ys, ms] = ymd.split("-").map(Number);
    const y = ys ?? 0;
    const m = ms ?? 1;
    const pm = m === 1 ? 12 : m - 1;
    const py = m === 1 ? y - 1 : y;
    const startYmd = `${py}-${pad2(pm)}-01`;
    const thisMonthStart = parseYmdStartIst(firstOfIstMonth(ymd));
    const lastYmd = ymdIst(new Date(thisMonthStart.getTime() - 1));
    return istInclusiveRange(startYmd, lastYmd);
}

/** IST calendar month as YYYY-MM */
export function istMonthYear(d = new Date()): string {
    return ymdIst(d).slice(0, 7);
}

/**
 * Next IST month settlement: 1st 02:00 Asia/Kolkata after `from`.
 * If `from` is already on/after that month's 02:00 on the 1st, skip to the following month.
 */
export function nextIstMonthSettlement(from = new Date()): Date {
    const ymd = ymdIst(from);
    const [ys, ms] = ymd.split("-").map(Number);
    let y = ys!;
    let m = ms!;
    const thisMonthSettle = new Date(
        `${y}-${String(m).padStart(2, "0")}-01T02:00:00+05:30`
    );
    if (from.getTime() < thisMonthSettle.getTime()) {
        return thisMonthSettle;
    }
    m += 1;
    if (m > 12) {
        m = 1;
        y += 1;
    }
    return new Date(`${y}-${String(m).padStart(2, "0")}-01T02:00:00+05:30`);
}
