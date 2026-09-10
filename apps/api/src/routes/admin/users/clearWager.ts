import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { penaltyHistoryAmounts } from "@bcwin/wager/penaltyHistory";
import { prisma } from "@bcwin/db";
import { SystemSettings } from "@bcwin/config";
import { Cache, CacheKey } from "@bcwin/cache";
import Logger from "@bcwin/logger";
import { authCookie } from "@/schemas";
import { apiError, CommonResponses } from "@/lib/utils";
import { HTTP_STATUS } from "@/lib/http";
import {
    getUserWagerStatus,
    liveRechargeMultiplier,
    syncRechargeWagerToLiveFactor,
    WAGER_TRANSACTION_TIMEOUT_MS,
} from "@/lib/wagerEngine";

const logger = new Logger("admin-users-clear-wager");
const wagerSnapshotSchema = z.object({
    multiplier: z.number(),
    depositWagerNeeded: z.number(),
    penaltyWagerNeeded: z.number(),
    rewardWagerNeeded: z.number(),
    totalWagerAmount: z.number(),
});

const route = createRoute({
    method: "post",
    path: "/:id/clear-extra-wagers",
    tags: ["admin"],
    summary: "Permanently clear existing extra wagers",
    request: {
        params: z.object({ id: z.string() }),
        cookies: authCookie,
        body: { content: { "application/json": {
            schema: z.object({ reason: z.string().trim().min(3).max(500) }),
        } } },
    },
    responses: {
        200: {
            description: "Extra wagers cleared",
            content: { "application/json": { schema: z.object({
                success: z.boolean(),
                message: z.string(),
                clearedAt: z.string(),
                clearedWagerAmount: z.number(),
                before: wagerSnapshotSchema,
                after: wagerSnapshotSchema,
            }) } },
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

export const clearWagerRoutes = (app: OpenAPIHono) => {
    app.openapi(route, async (c) => {
        try {
            const { id } = c.req.valid("param");
            const { reason } = c.req.valid("json");
            const admin = c.get("user");
            const config = await SystemSettings.get();

            const result = await prisma.$transaction(
                async (tx) => {
                    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id} FOR UPDATE`;
                    const user = await tx.user.findUnique({ where: { id } });
                    if (!user) return null;

                    const baseWagerFactor = liveRechargeMultiplier({
                        hasIllegalBetPenalty: false,
                        illegalBetPenaltyFactor: null,
                        configWager: config?.wager ?? 1,
                    });
                    const beforeStatus = await getUserWagerStatus(id, tx, config);
                    const beforeBasicDepositWager = Math.max(
                        0,
                        beforeStatus.depositWagerNeeded - beforeStatus.penaltyWagerNeeded
                    );
                    const before = {
                        multiplier: liveRechargeMultiplier({
                            hasIllegalBetPenalty: user.hasIllegalBetPenalty,
                            illegalBetPenaltyFactor: user.illegalBetPenaltyFactor,
                            configWager: config?.wager ?? 1,
                            configPenalty: config?.illegalBetPenaltyFactor,
                        }),
                        depositWagerNeeded: beforeBasicDepositWager,
                        penaltyWagerNeeded: beforeStatus.penaltyWagerNeeded,
                        rewardWagerNeeded: beforeStatus.rewardWagerNeeded,
                        totalWagerAmount: beforeStatus.totalNeedToBet,
                    };

                    await tx.$executeRaw`
                        UPDATE "WagerRequirement"
                        SET "isCleared" = true, "wagerCleared" = "requiredWager", "updatedAt" = NOW()
                        WHERE "userId" = ${id}
                          AND "sourceType" = 'REWARD'
                          AND "isCleared" = false
                    `;
                    await tx.user.update({
                        where: { id },
                        data: {
                            hasIllegalBetPenalty: false,
                            illegalBetPenaltyFactor: null,
                            zeroWagerEnabled: false,
                            zeroWagerConsumedAt: null,
                        },
                    });
                    await syncRechargeWagerToLiveFactor(id, baseWagerFactor, tx);
                    const afterStatus = await getUserWagerStatus(id, tx, config);
                    const after = {
                        multiplier: baseWagerFactor,
                        depositWagerNeeded: afterStatus.depositWagerNeeded,
                        penaltyWagerNeeded: afterStatus.penaltyWagerNeeded,
                        rewardWagerNeeded: afterStatus.rewardWagerNeeded,
                        totalWagerAmount: afterStatus.totalNeedToBet,
                    };
                    const clearedAt = new Date();

                    const clearEvent = await tx.wagerClearEvent.create({
                        data: {
                            userId: id,
                            clearedById: admin.id,
                            reason: reason.trim(),
                            previousPenaltyFactor: user.hasIllegalBetPenalty
                                ? user.illegalBetPenaltyFactor
                                : null,
                            baseWagerFactor,
                            beforeDepositWagerNeeded: before.depositWagerNeeded,
                            beforeRewardWagerNeeded: before.rewardWagerNeeded,
                            afterDepositWagerNeeded: after.depositWagerNeeded,
                            afterRewardWagerNeeded: after.rewardWagerNeeded,
                            createdAt: clearedAt,
                        },
                    });

                    await tx.penaltyHistoryEvent.create({ data: {
                        userId: id, eventKey: `clear:${clearEvent.id}`,
                        action: "EXTRA_WAGERS_CLEARED", reason: "ADMIN",
                        ...penaltyHistoryAmounts(before.multiplier, after.multiplier, beforeStatus, afterStatus),
                        createdAt: clearedAt,
                    } });

                    return {
                        before,
                        after,
                        clearedAt: clearedAt.toISOString(),
                        clearedWagerAmount: Math.max(
                            0,
                            before.totalWagerAmount - after.totalWagerAmount
                        ),
                    };
                },
                { maxWait: 5_000, timeout: WAGER_TRANSACTION_TIMEOUT_MS }
            );

            if (!result) return apiError(c, "User not found", HTTP_STATUS.BAD_REQUEST);
            await Promise.all([
                Cache.del(CacheKey.adminUserStats(id)),
                Cache.del(CacheKey.adminUsers),
            ]);
            logger.info("Extra wagers cleared", { userId: id, adminId: admin.id, ...result });
            return c.json({
                success: true,
                message: "Extra wagers cleared; basic deposit wager remains",
                ...result,
            }, HTTP_STATUS.OK);
        } catch (error) {
            logger.error(error);
            return apiError(c, "Internal server error", HTTP_STATUS.INTERNAL_SERVER_ERROR);
        }
    });
};
