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
            if (bonus.expiresAt && bonus.expiresAt < new Date()) {
                // Mark as expired
                await prisma.activityBonus.update({
                    where: { id: bonusId },
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
                // Update user balance
                const updatedUser = await tx.user.update({
                    where: { id: user.id },
                    data: { balance: { increment: bonus.amount } },
                    select: { balance: true },
                });

                // Update bonus status
                const updatedBonus = await tx.activityBonus.update({
                    where: { id: bonusId },
                    data: {
                        status: "COLLECTED",
                        claimAt: new Date(),
                    },
                });

                await createWagerRequirement(tx, user.id, "REWARD", bonus.amount, bonusId);

                return { updatedUser, updatedBonus };
            });

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
