import { Context, Next } from "hono";

import Logger from "@bcwin/logger";
import { prisma } from "@bcwin/db";
import { Cache } from "@bcwin/cache";
import { HTTP_STATUS } from "../lib/http";
import { middlewareApiError } from "../lib/utils";

const logger = new Logger("maintenance-middleware");

const CACHE_KEY = "system:maintenance";
const CACHE_TTL = 30; // seconds — short TTL so toggling takes effect quickly

interface MaintenanceState {
    enabled: boolean;
    message: string | null;
}

async function getMaintenanceState(): Promise<MaintenanceState> {
    const cached = await Cache.get<MaintenanceState>(CACHE_KEY);
    if (cached !== null && cached !== undefined) return cached;

    try {
        const config = await prisma.config.findFirst({
            select: { maintananceMode: true, maintananceMessage: true },
        });

        const state: MaintenanceState = {
            enabled: config?.maintananceMode ?? false,
            message: config?.maintananceMessage ?? null,
        };

        await Cache.set(CACHE_KEY, state, CACHE_TTL);
        return state;
    } catch (err) {
        // If DB is unreachable, fail open (do not block requests)
        logger.error("Failed to read maintenance config:", err);
        return { enabled: false, message: null };
    }
}

/**
 * Maintenance mode middleware.
 *
 * When `maintananceMode` is true in the Config table, all non-admin requests
 * receive a 503 response with the configured maintenance message.
 *
 * Admin routes (/api/v1/admin/*) are always allowed through so admins can
 * still log in and disable maintenance mode.
 */
export const maintenanceMiddleware = async (c: Context, next: Next) => {
    // Always allow admin routes through
    if (c.req.path.startsWith("/api/v1/admin")) {
        return await next();
    }

    const state = await getMaintenanceState();

    if (state.enabled) {
        logger.debug(`Blocked request in maintenance mode: ${c.req.path}`);
        return middlewareApiError(
            c,
            state.message ?? "The server is currently under maintenance. Please try again later.",
            HTTP_STATUS.SERVICE_UNAVAILABLE
        );
    }

    return await next();
};

/**
 * Call this after toggling maintenance mode to immediately invalidate the cache
 * so the change takes effect on the next request without waiting for TTL.
 */
export async function invalidateMaintenanceCache(): Promise<void> {
    await Cache.del(CACHE_KEY);
}
