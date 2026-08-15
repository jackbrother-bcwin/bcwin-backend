import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { prisma } from "@bcwin/db";
import { WebSocketManager } from "@bcwin/websocket";
import { Cache, CacheKey } from "@bcwin/cache";
import { Xdpay } from "@/lib/payment";
import {
    checkAndCreateFirstDepositBonus,
    checkAndCreateDailyBonuses,
    creditRechargeBonus,
} from "@bcwin/activity-bonus";
import * as Config from "@bcwin/config";
import { createWagerRequirement } from "@/lib/wagerEngine";

const SUCCESS_RETURN = "success";
const FAILURE_RETURN = "non-success";

const logger = new Logger("callback-payment-xdpay");

const XdpayDataSchema = z.any();
const XdpayResponseSchema = z.enum([SUCCESS_RETURN, FAILURE_RETURN]);

const xdpayDepositCallbackRoute = createRoute({
    method: "post",
    path: "/xdpay/deposit",
    tags: ["callback"],
    summary: "XDPay deposit callback",
    description: "XDPay deposit callback. Used to update the deposit status.",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: XdpayDataSchema,
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                "text/plain": {
                    schema: XdpayResponseSchema,
                },
            },
            description: "XDPay deposit callback",
        },
        ...CommonResponses.internalServerError(),
    },
});

const xdpayWithdrawCallbackRoute = createRoute({
    method: "post",
    path: "/xdpay/withdraw",
    tags: ["callback"],
    summary: "XDPay withdraw callback",
    description: "XDPay withdraw callback. Used to update the withdraw status.",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: XdpayDataSchema,
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                "text/plain": {
                    schema: XdpayResponseSchema,
                },
            },
            description: "XDPay withdraw callback",
        },
        ...CommonResponses.internalServerError(),
    },
});

export const xdpayCallbackRoutes = (app: OpenAPIHono) => {
    app.openapi(xdpayDepositCallbackRoute, async (c) => {
        try {
            const data = c.req.valid("json");

            if (!Xdpay.isXdpayCallbackData(data)) {
                return c.text(FAILURE_RETURN, HTTP_STATUS.OK);
            }

            if (!Xdpay.verify(data)) {
                return c.text(FAILURE_RETURN, HTTP_STATUS.OK);
            }

            logger.debug("[XDPAY_DEPOSIT_CALLBACK]", data);

            const statusVal = Number(data.status);
            const amountVal = Number(data.amount);

            if (statusVal === 1) {
                const principalInr = amountVal;
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
                    method: "XDPAY",
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
            } else if (statusVal === 0) {
                await prisma.deposit.update({
                    where: {
                        orderId: data.orderId,
                    },
                    data: {
                        status: "PROCESSING",
                    },
                });
            } else if (statusVal === 2) {
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

    app.openapi(xdpayWithdrawCallbackRoute, async (c) => {
        try {
            const data = c.req.valid("json");

            if (!Xdpay.isXdpayCallbackData(data)) {
                return c.text(FAILURE_RETURN, HTTP_STATUS.OK);
            }

            if (!Xdpay.verify(data)) {
                return c.text(FAILURE_RETURN, HTTP_STATUS.OK);
            }

            logger.debug("[XDPAY_WITHDRAW_CALLBACK]", data);

            const statusVal = Number(data.status);
            const amountVal = Number(data.amount);

            const withdraw = await prisma.withdraw.findUnique({
                where: {
                    orderId: data.orderId,
                    status: "PROCESSING",
                },
            });

            if (!withdraw) {
                return c.text(FAILURE_RETURN, HTTP_STATUS.OK);
            }

            if (statusVal === 1) {
                await prisma.withdraw.update({
                    where: {
                        orderId: data.orderId,
                    },
                    data: {
                        status: "SUCCESS",
                    },
                });
            } else if (statusVal === 0) {
                await prisma.withdraw.update({
                    where: {
                        orderId: data.orderId,
                    },
                    data: {
                        status: "PROCESSING",
                    },
                });
            } else if (statusVal !== 0) {
                const updatedWithdraw = await prisma.withdraw.update({
                    where: {
                        orderId: data.orderId,
                    },
                    data: {
                        status: "FAILED",
                        user: {
                            update: {
                                balance: {
                                    increment: amountVal,
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
