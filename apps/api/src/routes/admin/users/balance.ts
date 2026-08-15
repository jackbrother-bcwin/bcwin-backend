import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import {
    authCookie,
    UpdateBalanceBodySchema,
    UpdateBalanceResponseSchema,
} from "@/schemas";
import { prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import { createWagerRequirement } from "@/lib/wagerEngine";

const logger = new Logger("admin-users-balance");

const updateBalanceRoute = createRoute({
    method: "patch",
    path: "/:id/balance",
    tags: ["admin"],
    summary: "Update user balance",
    description: "Add or subtract amount from user balance",
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
                    schema: UpdateBalanceBodySchema,
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: UpdateBalanceResponseSchema,
                },
            },
            description: "User balance updated successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

export const balanceRoutes = (app: OpenAPIHono) => {
    app.openapi(updateBalanceRoute, async (c) => {
        try {
            const { id } = c.req.valid("param");
            const { amount, reason } = c.req.valid("json");
            const admin = c.get("user");

            const user = await prisma.user.findUnique({
                where: { id },
            });

            if (!user) {
                return apiError(c, "User not found", HTTP_STATUS.BAD_REQUEST);
            }

            const newBalance = user.balance + amount;

            if (newBalance < 0) {
                return apiError(
                    c,
                    "Insufficient balance. Cannot subtract more than current balance",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            const { updatedUser } = await prisma.$transaction(async (tx) => {
                const updatedUser = await tx.user.update({
                    where: { id },
                    data: {
                        balance: newBalance,
                    },
                });

                await tx.adminBalanceUpdateTransaction.create({
                    data: {
                        userId: id,
                        byUserId: admin.id,
                        amount,
                        reason: reason || "Balance update by admin",
                    },
                });

                if (amount > 0 && !/salary|commission/i.test(reason || "")) {
                    await createWagerRequirement(tx, id, "RECHARGE", amount);
                }

                return { updatedUser };
            });

            logger.info(
                `User ${id} balance updated by ${amount}. New balance: ${newBalance}. Reason: ${
                    reason || "N/A"
                }`
            );

            // Invalidate caches
            await Promise.all([
                Cache.del(CacheKey.adminUserStats(id)),
                Cache.del(CacheKey.adminUsers),
                Cache.del(CacheKey.adminBalanceTransactions),
            ]);

            return c.json(
                {
                    success: true,
                    message: "User balance updated successfully",
                    newBalance: updatedUser.balance,
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
