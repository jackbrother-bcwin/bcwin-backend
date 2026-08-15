import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import { prisma } from "@bcwin/db";
import { WebSocketManager } from "@bcwin/websocket";
import { createWagerRequirement } from "@/lib/wagerEngine";

const logger = new Logger("gift-redeem");

const GiftRedeemSchema = z.object({
    code: z.string().openapi({
        description: "The code of the gift to redeem",
        example: "123456",
    }),
});

const GiftRedeemResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the gift redeem was successful",
        example: true,
    }),
    amount: z.number().optional().openapi({
        description: "Amount of the redeemed gift",
        example: 100,
    }),
});

const giftRedeemRoute = createRoute({
    method: "post",
    path: "/redeem",
    tags: ["gift"],
    summary: "Redeem a gift",
    description: "Redeem a gift by providing the code",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: GiftRedeemSchema,
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: GiftRedeemResponseSchema,
                },
            },
            description: "Redeem a gift",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.notFound(),
        ...CommonResponses.internalServerError(),
    },
});

const giftHistoryRoute = createRoute({
    method: "get",
    path: "/gift/history",
    tags: ["gift"],
    summary: "Get gift redemption history",
    description: "Retrieve history of gifts redeemed by current user",
    request: {
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        data: z.array(
                            z.object({
                                id: z.string(),
                                code: z.string(),
                                amount: z.number(),
                                createdAt: z.string(),
                            })
                        ),
                    }),
                },
            },
            description: "Gift redemption history",
        },
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

export const giftRoutes = (app: OpenAPIHono) => {
    app.openapi(giftRedeemRoute, async (c) => {
        try {
            const code = c.req.valid("json").code;
            const user = c.get("user");

            const gift = await prisma.gift.findUnique({
                where: {
                    code,
                },
            });

            if (!gift) {
                return apiError(c, "Gift not found", HTTP_STATUS.NOT_FOUND);
            }

            if (gift.exaushted) {
                return apiError(
                    c,
                    "Gift code expired",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            const giftRedemption = await prisma.giftRedemption.findUnique({
                where: {
                    userId_giftId: {
                        userId: user.id,
                        giftId: gift.id,
                    },
                },
            });

            if (giftRedemption) {
                return apiError(
                    c,
                    "Gift already redeemed",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            const updatedUser = await prisma.user.update({
                where: { id: user.id },
                data: { balance: { increment: gift.amount } },
                select: {
                    balance: true,
                },
            });

            await createWagerRequirement(prisma, user.id, "REWARD", gift.amount, gift.id);

            WebSocketManager.publishToUser(user.id, "account-balance", {
                balance: updatedUser.balance,
            });

            const totalRedeemed = gift.totalRedeemed + 1;

            if (totalRedeemed >= gift.totalRedeemable) {
                await prisma.gift.update({
                    where: {
                        id: gift.id,
                    },
                    data: {
                        exaushted: true,
                        totalRedeemed,
                    },
                });
            } else {
                await prisma.gift.update({
                    where: {
                        id: gift.id,
                    },
                    data: {
                        totalRedeemed,
                    },
                });
            }

            await prisma.giftRedemption.create({
                data: {
                    userId: user.id,
                    giftId: gift.id,
                },
            });

            return c.json(
                {
                    success: true,
                    amount: gift.amount,
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

    app.openapi(giftHistoryRoute, async (c) => {
        try {
            const user = c.get("user");
            const history = await prisma.giftRedemption.findMany({
                where: { userId: user.id },
                include: {
                    gift: {
                        select: { code: true, amount: true },
                    },
                },
                orderBy: { createdAt: "desc" },
                take: 50,
            });

            return c.json(
                {
                    success: true,
                    data: history.map((h) => ({
                        id: h.id,
                        code: h.gift.code,
                        amount: h.gift.amount,
                        createdAt: h.createdAt.toISOString(),
                    })),
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Failed to fetch gift history", error);
            return apiError(
                c,
                "Failed to fetch gift history",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
