import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { prisma } from "@bcwin/db";
import { WebSocketManager } from "@bcwin/websocket";
import { Cache, CacheKey } from "@bcwin/cache";
import { Cxpay } from "@/lib/payment";
import {
    checkAndCreateFirstDepositBonus,
    checkAndCreateDailyBonuses,
    creditRechargeBonus,
} from "@bcwin/activity-bonus";
import * as Config from "@bcwin/config";
import { createWagerRequirement } from "@/lib/wagerEngine";

const logger = new Logger("callback-payment-cxpay");

const SUCCESS_RETURN = "success";
const FAILURE_RETURN = "non-success";

const CxpayDataSchema = z.any();

const CxpayResponseSchema = z.enum([SUCCESS_RETURN, FAILURE_RETURN]);

const cxpayDepositCallbackRoute = createRoute({
    method: "post",
    path: "/cxpay/deposit",
    tags: ["callback"],
    summary: "CXPay deposit callback",
    description: "CXPay deposit callback. Used to update the deposit status.",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: CxpayDataSchema,
                },
            },
        },
    },
    responses: {
        200: {
            // content: {
            //     "application/json": {
            //         schema: CxpayResponseSchema,
            //     },
            // },
            content: {
                "text/plain": {
                    schema: CxpayResponseSchema,
                },
            },
            description: "CXPay deposit callback",
        },
        ...CommonResponses.internalServerError(),
    },
});

const cxpayWithdrawCallbackRoute = createRoute({
    method: "post",
    path: "/cxpay/withdraw",
    tags: ["callback"],
    summary: "CXPay withdraw callback",
    description: "CXPay withdraw callback. Used to update the withdraw status.",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: CxpayDataSchema,
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                "text/plain": {
                    schema: CxpayResponseSchema,
                },
            },
            description: "CXPay withdraw callback",
        },
        ...CommonResponses.internalServerError(),
    },
});

export const cxpayCallbackRoutes = (app: OpenAPIHono) => {
    app.openapi(cxpayDepositCallbackRoute, async (c) => {
        try {
            const data = c.req.valid("json");

            if (!Cxpay.isCxpayCallbackData(data)) {
                return c.text(FAILURE_RETURN, HTTP_STATUS.OK);
            }

            if (!Cxpay.verify(data)) {
                return c.text(FAILURE_RETURN, HTTP_STATUS.OK);
            }

            logger.debug("[CXPAY_DEPOSIT_CALLBACK]", data);

            if (data.status == 1) {
                const principalInr = Number(data.amount) || 0;
                const inrBonusPct =
                    await Config.SystemSettings.getInrDepositBonusPercent();

                const updatedDeposit = await prisma.deposit.update({
                    where: {
                        orderId: data.orderId,
                    },
                    data: {
                        status: "SUCCESS",
                        amount: principalInr,
                        user: {
                            update: {
                                balance: {
                                    increment: principalInr,
                                },
                            },
                        },
                    },
                    include: {
                        user: {
                            select: {
                                balance: true,
                            },
                        },
                    },
                });

                await createWagerRequirement(
                    prisma,
                    updatedDeposit.userId,
                    "RECHARGE",
                    principalInr,
                    updatedDeposit.id
                );

                const { bonus } = await creditRechargeBonus({
                    userId: updatedDeposit.userId,
                    principalInr,
                    percent: inrBonusPct,
                    channel: "INR",
                    depositId: updatedDeposit.id,
                    orderId: data.orderId,
                    method: "CXPAY",
                });

                WebSocketManager.publishToUser(
                    updatedDeposit.userId,
                    "account-balance",
                    {
                        balance:
                            updatedDeposit.user.balance +
                            (bonus > 0 ? bonus : 0),
                    }
                );

                await Cache.del(CacheKey.userDeposits(updatedDeposit.userId));

                // Fire-and-forget: Check first deposit and daily bonuses
                checkAndCreateFirstDepositBonus(
                    updatedDeposit.userId,
                    principalInr
                );
                checkAndCreateDailyBonuses(updatedDeposit.userId);
            } else if (data.status == 0) {
                await prisma.deposit.update({
                    where: {
                        orderId: data.orderId,
                    },
                    data: {
                        status: "PROCESSING",
                    },
                });
            } else if (data.status == 2) {
                await prisma.deposit.update({
                    where: {
                        orderId: data.orderId,
                    },
                    data: {
                        status: "FAILED",
                    },
                });
            }

            return c.text(SUCCESS_RETURN, HTTP_STATUS.OK);
        } catch (error) {
            logger.error(error);
            return apiError(
                c,
                "Internal server error",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.openapi(cxpayWithdrawCallbackRoute, async (c) => {
        try {
            const data = c.req.valid("json");

            if (!Cxpay.isCxpayCallbackData(data)) {
                return c.text(FAILURE_RETURN, HTTP_STATUS.OK);
            }

            if (!Cxpay.verify(data)) {
                return c.text(FAILURE_RETURN, HTTP_STATUS.OK);
            }

            logger.debug("[CXPAY_WITHDRAW_CALLBACK]", data);

            const withdraw = await prisma.withdraw.findUnique({
                where: {
                    orderId: data.orderId,
                    status: "PROCESSING",
                },
            });

            if (!withdraw) {
                return c.text(FAILURE_RETURN, HTTP_STATUS.OK);
            }

            if (data.status == 1) {
                await prisma.withdraw.update({
                    where: {
                        orderId: data.orderId,
                    },
                    data: {
                        status: "SUCCESS",
                    },
                });
            } else if (data.status == 0) {
                await prisma.withdraw.update({
                    where: {
                        orderId: data.orderId,
                    },
                    data: {
                        status: "PROCESSING",
                    },
                });
            } else if (data.status != 0) {
                const updatedWithdraw = await prisma.withdraw.update({
                    where: {
                        orderId: data.orderId,
                    },
                    data: {
                        status: "FAILED",
                        user: {
                            update: {
                                balance: {
                                    increment: data.amount,
                                },
                            },
                        },
                    },
                    include: {
                        user: {
                            select: {
                                balance: true,
                            },
                        },
                    },
                });

                WebSocketManager.publishToUser(
                    updatedWithdraw.userId,
                    "account-balance",
                    {
                        balance: updatedWithdraw.user.balance,
                    }
                );
            }

            return c.text(SUCCESS_RETURN, HTTP_STATUS.OK);
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
