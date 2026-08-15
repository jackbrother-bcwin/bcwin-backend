/**
 * Sync UserVipLevel.currentLevel from live User.xp.
 * Place-bet increments XP immediately, but VIP level used to only update
 * on the daily 02:00 IST cron — FE showed full XP bar with VIP still locked.
 */
import { VipLevelService } from "../../../engine/src/services/vip/vipLevelService";
import Logger from "@bcwin/logger";

const logger = new Logger("vip-level-sync");

/** Await when caller needs the new level (e.g. GET /vip/status). */
export async function syncVipLevelFromXp(userId: string): Promise<number> {
    return VipLevelService.syncLevelFromXp(userId);
}

/** Non-blocking after place-bet. */
export function syncVipLevelFromXpAsync(userId: string): void {
    VipLevelService.syncLevelFromXp(userId).catch((err) =>
        logger.error(`VIP level sync failed for ${userId}:`, err)
    );
}
