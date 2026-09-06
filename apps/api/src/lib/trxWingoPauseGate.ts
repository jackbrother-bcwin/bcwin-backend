import type { Context } from "hono";
import { TRX_WINGO_BETS_LIVE, TRX_WINGO_PAUSE_MESSAGE } from "@bcwin/config";
import { HTTP_STATUS } from "./http";
import { apiError } from "./utils";

export function rejectIfTrxWingoBetsPaused(c: Context) {
    if (TRX_WINGO_BETS_LIVE) return null;
    return apiError(
        c,
        TRX_WINGO_PAUSE_MESSAGE,
        HTTP_STATUS.SERVICE_UNAVAILABLE
    );
}
