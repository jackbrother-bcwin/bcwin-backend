import type { Context } from "hono";
import { AUTO_SALARY_LIVE, AUTO_SALARY_PAUSED_MESSAGE } from "@bcwin/config";
import { HTTP_STATUS } from "./http";
import { apiError } from "./utils";

export function rejectIfAutoSalaryPaused(c: Context) {
    if (AUTO_SALARY_LIVE) return null;
    return apiError(
        c,
        AUTO_SALARY_PAUSED_MESSAGE,
        HTTP_STATUS.SERVICE_UNAVAILABLE
    );
}