import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import { prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import { comparePenaltyWager, liveRechargeMultiplier, syncRechargeWagerToLiveFactor, WAGER_TRANSACTION_TIMEOUT_MS } from "@bcwin/wager";
import { penaltyHistoryAmounts } from "@bcwin/wager/penaltyHistory";

const logger = new Logger("admin-users-penalty");

const UpdateUserPenaltyBodySchema = z.object({
    reason: z.enum(["SAME_IP", "ADMIN"]).default("ADMIN"),
    hasIllegalBetPenalty: z.boolean().openapi({
        description: "Whether the user has an active illegal betting penalty",
        example: true,
    }),
    illegalBetPenaltyFactor: z.number().positive().optional().openapi({
        description: "Penalty wager multiplier factor (e.g. 2, 3, 4). Defaults to system config factor if omitted when enabling penalty.",
        example: 3.0,
    }),
});

const UpdateUserPenaltyResponseSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    user: z.object({
        id: z.string(),
        hasIllegalBetPenalty: z.boolean(),
        illegalBetPenaltyFactor: z.number().nullable(),
    }),
});

const updateUserPenaltyRoute = createRoute({
    method: "post",
    path: "/:id/penalty",
    tags: ["admin"],
    summary: "Update user illegal betting penalty",
    description: "Assign, update penalty factor (e.g. 2x, 3x, 4x), or remove withdrawal penalty for a user",
    request: {
        params: z.object({
            id: z.string().openapi({
                description: "User ID",
                example: "uuid-123",
            }),
        }),
        body: {
            content: {
                "application/json": {
                    schema: UpdateUserPenaltyBodySchema,
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: UpdateUserPenaltyResponseSchema,
                },
            },
            description: "User penalty updated successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

export const penaltyRoutes = (app: OpenAPIHono) => {
    app.openapi(updateUserPenaltyRoute, async (c) => {
        try {
            const { id } = c.req.valid("param");
            const { hasIllegalBetPenalty, illegalBetPenaltyFactor, reason } = c.req.valid("json");
            const updatedUser = await prisma.$transaction(async (tx) => {
                await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id} FOR UPDATE`;
                const user = await tx.user.findUnique({ where: { id } });
                if (!user) return null;
                const config = await tx.config.findFirst();
                const penaltyFactor = hasIllegalBetPenalty
                    ? (illegalBetPenaltyFactor ?? config?.illegalBetPenaltyFactor ?? 3) : null;
                const next = { hasIllegalBetPenalty, illegalBetPenaltyFactor: penaltyFactor };
                const changed = user.hasIllegalBetPenalty !== hasIllegalBetPenalty
                    || user.illegalBetPenaltyFactor !== penaltyFactor;
                if (changed) {
                    const comparison = await comparePenaltyWager(tx, id, user, config, next);
                    await tx.penaltyHistoryEvent.create({ data: {
                        userId: id,
                        createdAt: new Date(),
                        action: !hasIllegalBetPenalty ? "CLEARED" : user.hasIllegalBetPenalty ? "ADJUSTED" : "APPLIED",
                        reason: hasIllegalBetPenalty ? reason : "ADMIN",
                        ...penaltyHistoryAmounts(comparison.previousFactor, comparison.resultingFactor,
                            comparison.before, comparison.after),
                    } });
                }
                await syncRechargeWagerToLiveFactor(id, liveRechargeMultiplier({
                    ...next, configWager: config?.wager ?? 1, configPenalty: config?.illegalBetPenaltyFactor,
                }), tx);
                return tx.user.update({ where: { id }, data: next, select: {
                    id: true, hasIllegalBetPenalty: true, illegalBetPenaltyFactor: true,
                } });
            }, { timeout: WAGER_TRANSACTION_TIMEOUT_MS });
            if (!updatedUser) return apiError(c, "User not found", HTTP_STATUS.BAD_REQUEST);
            const penaltyFactor = updatedUser.illegalBetPenaltyFactor;

            logger.info(
                `User ${id} penalty updated. Active: ${hasIllegalBetPenalty}, Factor: ${penaltyFactor}`
            );

            // Invalidate caches
            await Promise.all([
                Cache.del(CacheKey.adminUserStats(id)),
                Cache.del(CacheKey.adminUsers),
            ]);

            return c.json(
                {
                    success: true,
                    message: hasIllegalBetPenalty
                        ? `Penalty of ${penaltyFactor}x applied successfully`
                        : "Penalty cleared successfully",
                    user: updatedUser,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error(error);
            return apiError(
                c,
                "Internal server error",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
