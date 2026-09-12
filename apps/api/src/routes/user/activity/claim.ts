import { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import { claimBonusResponseSchema } from "@/schemas/activity";
import { z } from "@hono/zod-openapi";
import { WebSocketManager } from "@bcwin/websocket";
import { createWagerRequirement } from "@/lib/wagerEngine";
import { isNonExpiringBonus } from "@bcwin/activity-bonus/expiration";

const logger = new Logger("activity-claim");

const claimBonusBodySchema = z.object({
    bonusId: z.string().openapi({
        description: "Bonus ID to claim",
        example: "123e4567-e89b-12d3-a456-426614174000",
    }),
});

const claimBonusRoute = createRoute({
    method: "post",
    tags: ["user"],
    path: "/claim",
    summary: "Claim activity bonus",
    description:
        "Claim a COMPLETED_UNCOLLECTED bonus. Verifies bonus exists, belongs to user, not expired, and adds amount to balance.",
    request: {
        cookies: authCookie,
        body: {
            content: {
                "application/json": {
                    schema: claimBonusBodySchema,
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: claimBonusResponseSchema,
                },
            },
            description: "Successfully claimed bonus",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.notFound(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

export const activityClaimRoutes = (app: OpenAPIHono) => {
    app.openapi(claimBonusRoute, async (c) => {
        try {
            const user = c.get("user");
            const { bonusId } = c.req.valid("json");

            // Find the bonus
            const bonus = await prisma.activityBonus.findUnique({
                where: { id: bonusId },
            });

            if (!bonus) {
                return apiError(c, "Bonus not found", HTTP_STATUS.NOT_FOUND);
            }

            // Verify bonus belongs to user
            if (bonus.userId !== user.id) {
                return apiError(
                    c,
                    "Bonus does not belong to user",
                    HTTP_STATUS.UNAUTHORIZED
                );
            }

            // Verify bonus status
            if (bonus.status !== "COMPLETED_UNCOLLECTED") {
                return apiError(
                    c,
                    `Cannot claim bonus with status: ${bonus.status}`,
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            // Verify not expired
            if (!isNonExpiringBonus(bonus.type) && bonus.expiresAt && bonus.expiresAt < new Date()) {
                // Mark as expired
                await prisma.activityBonus.updateMany({
                    where: { id: bonusId, status: "COMPLETED_UNCOLLECTED" },
                    data: { status: "EXPIRED" },
                });

                return apiError(
                    c,
                    "Bonus has expired",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            // Claim bonus in transaction
            const result = await prisma.$transaction(async (tx) => {
                // Reserve the reward before crediting it. Concurrent requests must
                // recheck its status after waiting for the row lock.
                const claimAt = new Date();
                const claimed = await tx.activityBonus.updateMany({
                    where: {
                        id: bonusId,
                        userId: user.id,
                        status: "COMPLETED_UNCOLLECTED",
                        ...(!isNonExpiringBonus(bonus.type) ? {
                            OR: [{ expiresAt: null }, { expiresAt: { gte: claimAt } }],
                        } : {}),
                    },
                    data: {
                        status: "COLLECTED",
                        claimAt,
                        ...(isNonExpiringBonus(bonus.type) ? { expiresAt: null } : {}),
                    },
                });
                if (claimed.count !== 1) return null;

                // Update user balance
                const updatedUser = await tx.user.update({
                    where: { id: user.id },
                    data: { balance: { increment: bonus.amount } },
                    select: { balance: true },
                });

                const updatedBonus = await tx.activityBonus.findUniqueOrThrow({
                    where: { id: bonusId },
                });

                await createWagerRequirement(tx, user.id, "REWARD", bonus.amount, bonusId);

                return { updatedUser, updatedBonus };
            });

            if (!result) {
                return apiError(c, "Bonus is no longer available to claim", HTTP_STATUS.BAD_REQUEST);
            }

            // Publish balance update via WebSocket
            WebSocketManager.publishToUser(user.id, "account-balance", {
                balance: result.updatedUser.balance,
            });

            logger.debug(
                `User ${user.id} claimed ${bonus.type} bonus: ${bonus.amount}`
            );

            return c.json(
                {
                    success: true,
                    data: {
                        bonus: {
                            id: result.updatedBonus.id,
                            userId: result.updatedBonus.userId,
                            type: result.updatedBonus.type,
                            status: result.updatedBonus.status,
                            amount: result.updatedBonus.amount,
                            metadata: result.updatedBonus.metadata,
                            expiresAt:
                                result.updatedBonus.expiresAt?.toISOString(),
                            claimAt: result.updatedBonus.claimAt?.toISOString(),
                            createdAt:
                                result.updatedBonus.createdAt.toISOString(),
                            updatedAt:
                                result.updatedBonus.updatedAt.toISOString(),
                        },
                        newBalance: result.updatedUser.balance,
                    },
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error claiming bonus:", error);
            return apiError(
                c,
                "Failed to claim bonus",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
