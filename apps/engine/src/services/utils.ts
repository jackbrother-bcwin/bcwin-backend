/**
 * Utility functions for period creation logic
 * Uses IST (Asia/Kolkata) timezone for all calculations
 */

/**
 * Generates a period number based on time-derived logic
 * Format: YYYYMMDD + PERIOD_COUNT (4 digits)
 *
 * @param durationSeconds - Duration of the period in seconds
 * @returns Period number string (e.g., "202512280001")
 */
export function betLockSeconds(durationSeconds: number): number {
    return durationSeconds <= 30 ? 5 : 10;
}

function istParts(at: Date) {
    const istFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
    return istFormatter.formatToParts(at);
}

export function generatePeriodNumber(
    durationSeconds: number,
    at: Date = new Date()
): string {
    const parts = istParts(at);
    const year = parts.find((p) => p.type === "year")?.value || "";
    const month = parts.find((p) => p.type === "month")?.value || "";
    const day = parts.find((p) => p.type === "day")?.value || "";
    const hour = parseInt(
        parts.find((p) => p.type === "hour")?.value || "0",
        10
    );
    const minute = parseInt(
        parts.find((p) => p.type === "minute")?.value || "0",
        10
    );
    const second = parseInt(
        parts.find((p) => p.type === "second")?.value || "0",
        10
    );

    // Calculate seconds since midnight in IST
    const secondsSinceMidnight = hour * 3600 + minute * 60 + second;

    // Calculate period count: floor(secondsSinceMidnight / durationSeconds) + 1
    // +1 because at 00:00:00, period count should be 0001, not 0000
    const periodCount = Math.floor(secondsSinceMidnight / durationSeconds) + 1;

    // Format period count as 4-digit string (e.g., 0001, 0002, 0721, 1441)
    const periodCountStr = String(periodCount).padStart(4, "0");

    // PERIOD_NUMBER = YYYYMMDD + PERIOD_COUNT
    return `${year}${month}${day}${periodCountStr}`;
}

/**
 * Calculates period start and end times based on current IST time
 *
 * @param durationSeconds - Duration of the period in seconds
 * @returns Object containing startTime and endTime as Date objects
 */
export function calculatePeriodTimes(
    durationSeconds: number,
    at: Date = new Date()
): {
    startTime: Date;
    endTime: Date;
} {
    const parts = istParts(at);
    const hour = parseInt(
        parts.find((p) => p.type === "hour")?.value || "0",
        10
    );
    const minute = parseInt(
        parts.find((p) => p.type === "minute")?.value || "0",
        10
    );
    const second = parseInt(
        parts.find((p) => p.type === "second")?.value || "0",
        10
    );

    // Calculate period start time components in IST
    let periodStartSecond: number;
    let periodStartMinute: number = minute;
    let periodStartHour: number = hour;

    if (durationSeconds === 30) {
        // For 30-second periods: align to 30-second intervals (:00 and :30)
        const periodIndex = Math.floor(second / 30);
        periodStartSecond = periodIndex * 30;
    } else {
        // For longer periods: align to minute intervals
        const periodIndex = Math.floor(minute / (durationSeconds / 60));
        periodStartMinute = periodIndex * (durationSeconds / 60);
        periodStartSecond = 0;
    }

    // Get IST date string and create period start time
    // Format: YYYY-MM-DDTHH:mm:ss+05:30
    const year = parts.find((p) => p.type === "year")?.value || "";
    const month = parts.find((p) => p.type === "month")?.value || "";
    const day = parts.find((p) => p.type === "day")?.value || "";

    const istDateString = `${year}-${month}-${day}T${String(
        periodStartHour
    ).padStart(2, "0")}:${String(periodStartMinute).padStart(2, "0")}:${String(
        periodStartSecond
    ).padStart(2, "0")}+05:30`;
    const periodStart = new Date(istDateString);

    const periodEnd = new Date(periodStart.getTime() + durationSeconds * 1000);

    return { startTime: periodStart, endTime: periodEnd };
}
