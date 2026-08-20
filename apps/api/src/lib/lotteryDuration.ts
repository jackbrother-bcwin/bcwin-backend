/**
 * Player-facing lottery period length.
 * 30s is "30sec", never "0.5Min".
 */
export function lotteryDurationLabel(durationSeconds: number): string {
    const sec = Number(durationSeconds);
    if (!Number.isFinite(sec) || sec <= 0) return "";
    if (sec < 60) return `${Math.round(sec)}sec`;
    const mins = sec / 60;
    if (Number.isInteger(mins)) return `${mins}Min`;
    return `${Math.round(sec)}sec`;
}

export function wingoGameName(durationSeconds: number): string {
    const d = lotteryDurationLabel(durationSeconds);
    return d ? `Wingo ${d}` : "Wingo";
}
