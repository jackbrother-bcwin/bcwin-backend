import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { prisma } from "@bcwin/db";
import { WebSocketManager } from "@bcwin/websocket";
import { Cache, CacheKey } from "@bcwin/cache";
import { Oxapay } from "@/lib/payment";
import {
    checkAndCreateFirstDepositBonus,
    checkAndCreateDailyBonuses,
    creditRechargeBonus,
} from "@bcwin/activity-bonus";
import * as Config from "@bcwin/config";
import { createWagerRequirement } from "@/lib/wagerEngine";

const SUCCESS_RETURN = "ok";
const FAILURE_RETURN = "error";

const logger = new Logger("callback-payment-oxapay");

/**
 * OxaPay payout IPN has no order_id field — we store our orderId in `description`.
 * Older approve path sent `Withdraw order ${orderId}`; new path sends bare orderId.
 */
function resolveOxapayWithdrawOrderId(description: unknown): string | null {
    if (typeof description !== "string") return null;
    const trimmed = description.trim();
    if (!trimmed) return null;
    const prefix = "Withdraw order ";
    if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
        const id = trimmed.slice(prefix.length).trim();
        return id || null;
    }
    return trimmed;
}

const OxapayDataSchema = z.any();
const OxapayResponseSchema = z.enum([SUCCESS_RETURN, FAILURE_RETURN]);

const oxapayDepositCallbackRoute = createRoute({
    method: "post",
    path: "/oxapay/deposit",
    tags: ["callback"],
    summary: "OxaPay deposit callback",
    description: "OxaPay deposit callback. Used to update the deposit status.",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: OxapayDataSchema,
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                "text/plain": {
                    schema: OxapayResponseSchema,
                },
            },
            description: "OxaPay deposit callback",
        },
        ...CommonResponses.internalServerError(),
    },
});

const oxapayWithdrawCallbackRoute = createRoute({
    method: "post",
    path: "/oxapay/withdraw",
    tags: ["callback"],
    summary: "OxaPay withdraw callback",
    description: "OxaPay withdraw callback. Used to update the withdraw status.",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: OxapayDataSchema,
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                "text/plain": {
                    schema: OxapayResponseSchema,
                },
            },
            description: "OxaPay withdraw callback",
        },
        ...CommonResponses.internalServerError(),
    },
});

export const oxapayCallbackRoutes = (app: OpenAPIHono) => {
    app.openapi(oxapayDepositCallbackRoute, async (c) => {
        try {
            const rawBody = await c.req.text();
            const hmacHeader = c.req.header("HMAC") || "";

            if (!Oxapay.verify(rawBody, hmacHeader)) {
                logger.error("[OXAPAY_DEPOSIT_CALLBACK] Verification failed");
                return c.text(FAILURE_RETURN, HTTP_STATUS.OK);
            }

            const data = JSON.parse(rawBody);

            if (!Oxapay.isOxapayCallbackData(data)) {
                logger.error("[OXAPAY_DEPOSIT_CALLBACK] Invalid callback structure");
                return c.text(FAILURE_RETURN, HTTP_STATUS.OK);
            }

            logger.debug("[OXAPAY_DEPOSIT_CALLBACK] Received", data);

            const statusVal = data.status.toLowerCase();
            const amountVal = Number(data.amount);

            const config = await Config.SystemSettings.get();
            const rate = config?.inrToUsdtPaymentConversionRate!;

            if (statusVal === "paid") {
                // Principal only on deposit.amount; promo % is separate ActivityBonus
                const principalInr = Math.floor(amountVal * rate);
                const usdtAmountVal = amountVal;
                const usdtBonusPct =
                    await Config.SystemSettings.getUsdtDepositBonusPercent();

                const updatedDeposit = await prisma.deposit.update({
                    where: {
                        orderId: data.order_id,
                    },
                    data: {
                        status: "SUCCESS",
                        metadata: data as any,
                        amount: principalInr,
                        usdtAmount: usdtAmountVal,
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
                    percent: usdtBonusPct,
                    channel: "USDT",
                    depositId: updatedDeposit.id,
                    orderId: data.order_id ?? "",
                    method: "OXAPAY",
                    usdtAmount: usdtAmountVal,
                });

                const bal =
                    updatedDeposit.user.balance + (bonus > 0 ? bonus : 0);
                WebSocketManager.publishToUser(
                    updatedDeposit.userId,
                    "account-balance",
                    {
                        balance: bal,
                    }
                );

                // Invalidate deposit history / 3rd-party recharge gate totals
                await Cache.del(CacheKey.userDeposits(updatedDeposit.userId));

                // Fire-and-forget: Check first deposit and daily bonuses (principal)
                checkAndCreateFirstDepositBonus(
                    updatedDeposit.userId,
                    principalInr
                );
                checkAndCreateDailyBonuses(updatedDeposit.userId);
            } else if (statusVal === "paying" || statusVal === "waiting") {
                await prisma.deposit.update({
                    where: {
                        orderId: data.order_id,
                    },
                    data: {
                        status: "PROCESSING",
                        metadata: data as any,
                    },
                });
            } else if (statusVal === "expired" || statusVal === "failed") {
                await prisma.deposit.update({
                    where: {
                        orderId: data.order_id,
                    },
                    data: {
                        status: "FAILED",
                        metadata: data as any,
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

    app.openapi(oxapayWithdrawCallbackRoute, async (c) => {
        try {
            const rawBody = await c.req.text();
            const hmacHeader = c.req.header("HMAC") || "";

            if (!Oxapay.verify(rawBody, hmacHeader)) {
                logger.error("[OXAPAY_WITHDRAW_CALLBACK] Verification failed");
                return c.text(FAILURE_RETURN, HTTP_STATUS.OK);
            }

            const data = JSON.parse(rawBody);

            if (!Oxapay.isOxapayCallbackData(data)) {
                logger.error("[OXAPAY_WITHDRAW_CALLBACK] Invalid callback structure");
                return c.text(FAILURE_RETURN, HTTP_STATUS.OK);
            }

            logger.debug("[OXAPAY_WITHDRAW_CALLBACK] Received", data);

            const statusVal = data.status.toLowerCase();
            const amountVal = Number(data.amount);
            const orderId = resolveOxapayWithdrawOrderId(data.description);

            if (!orderId) {
                logger.error(
                    "[OXAPAY_WITHDRAW_CALLBACK] No orderId found in description",
                    { description: data.description, track_id: data.track_id }
                );
                return c.text(FAILURE_RETURN, HTTP_STATUS.OK);
            }

            const withdraw = await prisma.withdraw.findFirst({
                where: {
                    orderId,
                    status: "PROCESSING",
                },
            });

            if (!withdraw) {
                logger.error(
                    "[OXAPAY_WITHDRAW_CALLBACK] No PROCESSING withdraw for orderId",
                    {
                        orderId,
                        description: data.description,
                        track_id: data.track_id,
                        status: data.status,
                    }
                );
                return c.text(FAILURE_RETURN, HTTP_STATUS.OK);
            }

            const config = await Config.SystemSettings.get();
            const rate = config?.inrToUsdtWithdrawalConversionRate!;

            if (statusVal === "confirmed" || statusVal === "complete") {
                const amountInr = Math.floor(amountVal * rate);
                await prisma.withdraw.update({
                    where: {
                        orderId: orderId,
                    },
                    data: {
                        status: "SUCCESS",
                        metadata: data as any,
                        amount: amountInr,
                        usdtAmount: amountVal,
                    },
                });
            } else if (statusVal === "confirming" || statusVal === "pending") {
                await prisma.withdraw.update({
                    where: {
                        orderId: orderId,
                    },
                    data: {
                        status: "PROCESSING",
                        metadata: data as any,
                    },
                });
            } else if (statusVal === "failed" || statusVal === "rejected") {
                const amountInr = Math.floor(amountVal * rate);
                const refundAmount = withdraw.amount;

                const updatedWithdraw = await prisma.withdraw.update({
                    where: {
                        orderId: orderId,
                    },
                    data: {
                        status: "FAILED",
                        metadata: data as any,
                        amount: amountInr,
                        usdtAmount: amountVal,
                        user: {
                            update: {
                                balance: {
                                    increment: refundAmount,
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
