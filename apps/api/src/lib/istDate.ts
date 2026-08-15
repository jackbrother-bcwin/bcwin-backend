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
