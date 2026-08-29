import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { createHash } from "crypto";

import {
    apiError,
    CommonResponses,
    getTotalUserBets,
    getClientIp,
} from "@/lib/utils";
import { Cxpay, Xdpay, Oxapay, generateOrderId } from "@/lib/payment";
import { HTTP_STATUS } from "@/lib/http";
import { authCookie } from "@/schemas";
import { prisma, WithdrawOrderStatus } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import Logger from "@bcwin/logger";
import * as Config from "@bcwin/config";
import { WebSocketManager } from "@bcwin/websocket";
import { logIpActivity, IpActivityType } from "@/lib/ipActivity";
import {
    checkAndCreateFirstDepositBonus,
    checkAndCreateDailyBonuses,
    creditRechargeBonus,
} from "@bcwin/activity-bonus";
import { createWagerRequirement, getUserWagerStatus } from "@/lib/wagerEngine";
import {
    isValidBankAccount,
    isValidBep20Address,
    isValidIfsc,
    isValidRecipientName,
    isValidTrc20Address,
    isValidUpiId,
} from "@/schemas/bankDetails";

const logger = new Logger("payment");

/** Drop deposit-history cache so PROCESSING / SUCCESS lists stay fresh */
async function invalidateUserDepositCache(userId: string) {
    try {
        await Cache.del(CacheKey.userDeposits(userId));
    } catch (e) {
        logger.warn("Failed to invalidate user deposit cache", e);
    }
}

async function invalidateUserWithdrawCache(userId: string) {
    try {
        await Cache.del(CacheKey.userWithdrawals(userId));
        await Cache.del(CacheKey.adminWithdrawals);
    } catch (e) {
        logger.warn("Failed to invalidate user withdraw cache", e);
    }
}

const DepositSchema = z.object({
    amount: z
        .number()
        .openapi({
            description: "The amount to deposit",
            example: 100,
        }),
    method: z.enum(Config.PAYMENT_METHODS).openapi({
        description: "The method to deposit",
        example: "CXPAY",
    }),
});

const DepositResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the deposit was successfully initiated",
        example: true,
    }),
    payUrl: z.string().optional().openapi({
        description: "The URL to pay. UPI method does not return a pay URL",
        example: "https://cxpay.com/pay/1234567890",
    }),
});

const WithdrawSchema = z.object({
    amount: z
        .number()
        .openapi({
            description: "The amount to withdraw",
            example: 300,
        }),
    method: z.enum(Config.WITHDRAW_METHODS).openapi({
        description: "The method to withdraw",
        example: "CXPAY",
    }),
    cryptoChain: z.enum(["BEP20", "TRC20"]).optional().openapi({
        description: "The crypto chain to use for withdrawal (BEP20 or TRC20)",
        example: "TRC20",
    }),
    note: z.string().optional().openapi({
        description: "The note to add to the withdraw",
        example: "This is a note for the withdraw",
    }),
    /** Login password — required to authorize withdrawal */
    password: z
        .string()
        .min(1)
        .openapi({
            description: "Account login password",
            example: "Password123!",
        }),
});

const WithdrawResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the withdraw was successfully initiated",
        example: true,
    }),
});

const CancelWithdrawSchema = z.object({
    orderId: z.string().openapi({
        description: "The order ID of the withdrawal to cancel",
        example: "20250112-12345678901234",
    }),
});

const CancelWithdrawResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the cancellation was successful",
        example: true,
    }),
    message: z.string().openapi({
        description: "Result message",
        example: "Withdrawal cancelled successfully",
    }),
});

/** Public payment rates for UI (USDT → INR estimate on deposit screen) */
const PaymentRatesResponseSchema = z.object({
    success: z.boolean().openapi({ example: true }),
    /** 1 USDT credits this many INR on deposit (admin config) */
    inrToUsdtPaymentConversionRate: z.number().openapi({
        description: "INR credited per 1 USDT deposited",
        example: 105,
    }),
    inrToUsdtWithdrawalConversionRate: z.number().openapi({
        description: "INR per 1 USDT on withdrawal conversion",
        example: 100,
    }),
    minDepositAmount: z.number().openapi({
        description: "Minimum deposit in INR",
        example: 100,
    }),
    /** % of INR principal as INR_RECHARGE_BONUS (0 = off) */
    inrDepositBonusPercent: z.number().openapi({
        description: "% of INR deposit principal credited as recharge bonus",
        example: 0,
    }),
    /** % of USDT principal (after pay rate) as USDT_RECHARGE_BONUS */
    usdtDepositBonusPercent: z.number().openapi({
        description: "% of USDT principal credited as recharge bonus",
        example: 5,
    }),
});

const PaymentRatesRoute = createRoute({
    method: "get",
    path: "/rates",
    tags: ["payment"],
    summary: "Payment conversion rates",
    description:
        "Returns USDT↔INR conversion rates, min deposit, and recharge bonus % for wallet UI estimates",
    request: {
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: PaymentRatesResponseSchema,
                },
            },
            description: "Rates loaded",
        },
        ...CommonResponses.internalServerError(),
    },
});

const DepositRoute = createRoute({
    method: "post",
    path: "/deposit",
    tags: ["payment"],
    summary: "Initiate a deposit",
    description: "Initiate a deposit by providing the amount and method",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: DepositSchema,
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: DepositResponseSchema,
                },
            },
            description: "Deposit initiated successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.serviceUnavailable(),
        ...CommonResponses.internalServerError(),
    },
});

const WithdrawRoute = createRoute({
    method: "post",
    path: "/withdraw",
    tags: ["payment"],
    summary: "Initiate a withdraw",
    description: "Initiate a withdraw by providing the amount and method",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: WithdrawSchema,
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: WithdrawResponseSchema,
                },
            },
            description: "Withdraw initiated successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.serviceUnavailable(),
        ...CommonResponses.internalServerError(),
    },
});

const WithdrawInfoResponseSchema = z.object({
    success: z.boolean(),
    data: z.object({
        /** INR still required to wager before withdraw is allowed (0 = clear) */
        needToBet: z.number(),
        depositWagerNeeded: z.number().optional(),
        rewardWagerNeeded: z.number().optional(),
        isWithdrawalFrozen: z.boolean().optional(),
        totalRecharge: z.number(),
        totalBets: z.number(),
        wagerFactor: z.number(),
        remainingWithdrawalsToday: z.number(),
        maxWithdrawalsPerDay: z.number(),
    }),
});

const WithdrawInfoRoute = createRoute({
    method: "get",
    path: "/withdraw/info",
    tags: ["payment"],
    summary: "Withdraw eligibility info",
    description:
        "Returns remaining wager requirement (need to bet) and remaining withdrawal attempts today.",
    request: {
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: WithdrawInfoResponseSchema,
                },
            },
            description: "OK",
        },
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

const CancelWithdrawRoute = createRoute({
    method: "post",
    path: "/withdraw/cancel",
    tags: ["payment"],
    summary: "Cancel a pending withdrawal",
    description: "Cancel a pending withdrawal in GENERATED state and refund the balance",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: CancelWithdrawSchema,
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: CancelWithdrawResponseSchema,
                },
            },
            description: "Withdrawal cancelled successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

export const paymentRoutes = (app: OpenAPIHono) => {
    app.openapi(PaymentRatesRoute, async (c) => {
        try {
            const config = await Config.SystemSettings.get();
            return c.json(
                {
                    success: true,
                    inrToUsdtPaymentConversionRate:
                        config?.inrToUsdtPaymentConversionRate ?? 105,
                    inrToUsdtWithdrawalConversionRate:
                        config?.inrToUsdtWithdrawalConversionRate ?? 100,
                    minDepositAmount: config?.minDepositAmount ?? 100,
                    inrDepositBonusPercent:
                        (config as { inrDepositBonusPercent?: number } | null)
                            ?.inrDepositBonusPercent ?? 0,
                    usdtDepositBonusPercent:
                        (config as { usdtDepositBonusPercent?: number } | null)
                            ?.usdtDepositBonusPercent ?? 5,
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

    app.openapi(WithdrawInfoRoute, async (c) => {
        try {
            const user = c.get("user");

            const maxWithdrawApplicationsPerDay =
                await Config.SystemSettings.getMaxWithdrawApplicationsPerDay();

            const startOfToday = new Date();
            startOfToday.setHours(0, 0, 0, 0);
            const endOfToday = new Date();
            endOfToday.setHours(23, 59, 59, 999);

            const [
                totalWithdrawApplicationsToday,
                totalUserRecharge,
                totalUserBets,
                baseWagerFactor,
                wagerStatus,
            ] = await Promise.all([
                prisma.withdraw.count({
                    where: {
                        userId: user.id,
                        createdAt: {
                            gte: startOfToday,
                            lte: endOfToday,
                        },
                    },
                }),
                prisma.deposit
                    .aggregate({
                        where: {
                            userId: user.id,
                            status: "SUCCESS",
                        },
                        _sum: { amount: true },
                    })
                    .then((r) => r._sum.amount || 0),
                getTotalUserBets(user.id),
                Config.SystemSettings.getWagerFactor(),
                getUserWagerStatus(user.id),
            ]);

            const wagerFactor = user.hasIllegalBetPenalty
                ? (user.illegalBetPenaltyFactor ?? 3.0)
                : baseWagerFactor;

            const remainingWithdrawalsToday = Math.max(
                0,
                maxWithdrawApplicationsPerDay - totalWithdrawApplicationsToday
            );

            return c.json(
                {
                    success: true,
                    data: {
                        needToBet: wagerStatus.totalNeedToBet,
                        depositWagerNeeded: wagerStatus.depositWagerNeeded,
                        rewardWagerNeeded: wagerStatus.rewardWagerNeeded,
                        isWithdrawalFrozen: wagerStatus.isWithdrawalFrozen,
                        totalRecharge: totalUserRecharge,
                        totalBets: totalUserBets,
                        wagerFactor,
                        remainingWithdrawalsToday,
                        maxWithdrawalsPerDay: maxWithdrawApplicationsPerDay,
                    },
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

    app.openapi(DepositRoute, async (c) => {
        try {
            const user = c.get("user");

            const { amount, method } = c.req.valid("json");
            const orderId = generateOrderId();

            if (method !== "OXAPAY") {
                const minDepositAmount = await Config.SystemSettings.getMinDepositAmount();
                if (amount < minDepositAmount) {
                    return apiError(
                        c,
                        `Deposit amount must be at least ${minDepositAmount}`,
                        HTTP_STATUS.BAD_REQUEST
                    );
                }
            }

            // ── Demo account: instant SUCCESS deposit, no payment gateway ──
            if (user.isDemo) {
                const config = await Config.SystemSettings.get();
                let principalInr = Math.floor(amount);
                let usdtAmount: number | undefined;
                let bonusChannel: "INR" | "USDT" = "INR";
                let bonusPercent =
                    await Config.SystemSettings.getInrDepositBonusPercent();

                if (method === "OXAPAY") {
                    const conversionRate =
                        config?.inrToUsdtPaymentConversionRate ?? 105;
                    const minDepositAmount = config?.minDepositAmount ?? 100;
                    const amountInInr = amount * conversionRate;
                    if (amountInInr < minDepositAmount) {
                        return apiError(
                            c,
                            `Deposit amount must be at least ${minDepositAmount} INR (approx ${(minDepositAmount / conversionRate).toFixed(2)} USD)`,
                            HTTP_STATUS.BAD_REQUEST
                        );
                    }
                    principalInr = Math.floor(amountInInr);
                    usdtAmount = amount;
                    bonusChannel = "USDT";
                    bonusPercent =
                        await Config.SystemSettings.getUsdtDepositBonusPercent();
                }

                const { deposit, updatedUser } = await prisma.$transaction(
                    async (tx) => {
                        const deposit = await tx.deposit.create({
                            data: {
                                userId: user.id,
                                amount: principalInr,
                                method,
                                status: "SUCCESS",
                                orderId,
                                usdtAmount,
                                metadata: {
                                    demo: true,
                                    dummy: true,
                                    note: "Payment Success",
                                },
                            },
                        });

                        const updatedUser = await tx.user.update({
                            where: { id: user.id },
                            data: { balance: { increment: principalInr } },
                            select: { balance: true },
                        });

                        await createWagerRequirement(tx, user.id, "RECHARGE", principalInr, deposit.id);

                        return { deposit, updatedUser };
                    }
                );

                const { bonus } = await creditRechargeBonus({
                    userId: user.id,
                    principalInr,
                    percent: bonusPercent,
                    channel: bonusChannel,
                    depositId: deposit.id,
                    orderId,
                    method,
                    usdtAmount: usdtAmount ?? null,
                });

                const bal = updatedUser.balance + (bonus > 0 ? bonus : 0);
                WebSocketManager.publishToUser(user.id, "account-balance", {
                    balance: bal,
                });

                await invalidateUserDepositCache(user.id);
                try {
                    await Cache.del(CacheKey.adminDeposits);
                } catch {
                    /* ignore */
                }

                checkAndCreateFirstDepositBonus(user.id, principalInr);
                checkAndCreateDailyBonuses(user.id);

                const ip = getClientIp(c);
                if (ip) {
                    logIpActivity({
                        ip,
                        userId: user.id,
                        activityType: IpActivityType.DEPOSIT,
                        metadata: {
                            amount: principalInr,
                            method,
                            orderId,
                            demo: true,
                        },
                    });
                }

                logger.info(
                    `[DEMO_DEPOSIT] user=${user.id} amount=${principalInr} method=${method} order=${orderId}`
                );

                return c.json({ success: true }, HTTP_STATUS.OK);
            }

            if (method === "CXPAY") {
                if (!(await Config.SystemSettings.getCxpayEnabled())) {
                    return apiError(
                        c,
                        "CXPAY is disabled",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }

                // ! paycode setup for if multiple paycodes are enabled by cxpay
                // const channel = searchParams.get("channel") ?? "upi1";

                // const upiCodeMap: Record<string, string> = {
                //     upi1: "36301",
                //     upi2: "38301",
                //     upi3: "38101",
                //     upi4: "37501",
                // };

                // const payCode = upiCodeMap[channel];

                const resp = await Cxpay.initiatePayment(
                    amount,
                    orderId,
                );

                if (
                    resp.code !== 200 &&
                    resp.msg !== "success" &&
                    !resp.success
                ) {
                    return apiError(
                        c,
                        `${resp.msg}: ${resp.desc}`,
                        HTTP_STATUS.SERVICE_UNAVAILABLE
                    );
                }

                const deposit = await prisma.deposit.create({
                    data: {
                        userId: user.id,
                        amount,
                        method,
                        status: "PROCESSING",
                        orderId,
                    },
                });
                await invalidateUserDepositCache(user.id);

                // Log IP activity for deposit
                const ip = getClientIp(c);
                if (ip) {
                    logIpActivity({
                        ip,
                        userId: user.id,
                        activityType: IpActivityType.DEPOSIT,
                        metadata: {
                            amount,
                            method,
                            orderId: deposit.orderId,
                        },
                    });
                }

                return c.json(
                    {
                        success: true,
                        payUrl: resp.data.url,
                    },
                    HTTP_STATUS.OK
                );
            } else if (method === "XDPAY") {
                if (!(await Config.SystemSettings.getXdpayEnabled())) {
                    return apiError(
                        c,
                        "XDPAY is disabled",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }

                const resp = await Xdpay.initiatePayment(
                    amount.toString(),
                    orderId
                );

                if (
                    resp.code !== 200 &&
                    resp.msg !== "success" &&
                    !resp.success
                ) {
                    return apiError(
                        c,
                        `${resp.msg}: ${resp.desc}`,
                        HTTP_STATUS.SERVICE_UNAVAILABLE
                    );
                }

                const deposit = await prisma.deposit.create({
                    data: {
                        userId: user.id,
                        amount,
                        method,
                        status: "PROCESSING",
                        orderId,
                    },
                });
                await invalidateUserDepositCache(user.id);

                // Log IP activity for deposit
                const ip = getClientIp(c);
                if (ip) {
                    logIpActivity({
                        ip,
                        userId: user.id,
                        activityType: IpActivityType.DEPOSIT,
                        metadata: {
                            amount,
                            method,
                            orderId: deposit.orderId,
                        },
                    });
                }

                return c.json(
                    {
                        success: true,
                        payUrl: resp.data.url,
                    },
                    HTTP_STATUS.OK
                );
            } else if (method === "OXAPAY") {
                if (!(await Config.SystemSettings.getOxapayEnabled())) {
                    return apiError(
                        c,
                        "OXAPAY is disabled",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }

                const config = await Config.SystemSettings.get();
                const conversionRate = config?.inrToUsdtPaymentConversionRate!;
                const minDepositAmount = config?.minDepositAmount!;

                const amountToInitiate = amount; // USD amount
                const amountInInr = amount * conversionRate;
                if (amountInInr < minDepositAmount) {
                    return apiError(
                        c,
                        `Deposit amount must be at least ${minDepositAmount} INR (approx ${(minDepositAmount / conversionRate).toFixed(2)} USD)`,
                        HTTP_STATUS.BAD_REQUEST
                    );
                }
                const finalDepositAmount = Math.floor(amountInInr); // INR amount

                const resp = await Oxapay.initiatePayment(
                    amountToInitiate,
                    orderId,
                );

                if (resp.status !== 200) {
                    logger.error("[DEPOSIT_OXAPAY]", resp);
                    return apiError(
                        c,
                        `Unable to initiate deposit at the moment. ${resp.message || ""}`,
                        HTTP_STATUS.SERVICE_UNAVAILABLE
                    );
                }

                const deposit = await prisma.deposit.create({
                    data: {
                        user: {
                            connect: {
                                id: user.id,
                            },
                        },
                        amount: finalDepositAmount,
                        method,
                        status: "PROCESSING",
                        orderId,
                        metadata: resp as any,
                        usdtAmount: amountToInitiate,
                    },
                });
                await invalidateUserDepositCache(user.id);

                // Log IP activity for deposit
                const ip = getClientIp(c);
                if (ip) {
                    logIpActivity({
                        ip,
                        userId: user.id,
                        activityType: IpActivityType.DEPOSIT,
                        metadata: {
                            amount: finalDepositAmount,
                            method,
                            orderId: deposit.orderId,
                        },
                    });
                }

                return c.json(
                    {
                        success: true,
                        payUrl: resp.data.payment_url,
                    },
                    HTTP_STATUS.OK
                );
            } else if (method === "UPI") {
                if (!(await Config.SystemSettings.getUpiEnabled())) {
                    return apiError(
                        c,
                        "UPI is disabled",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }

                const deposit = await prisma.deposit.create({
                    data: {
                        userId: user.id,
                        amount,
                        method,
                        status: "PROCESSING",
                        orderId,
                    },
                });
                await invalidateUserDepositCache(user.id);

                // Log IP activity for deposit
                const ip = getClientIp(c);
                if (ip) {
                    logIpActivity({
                        ip,
                        userId: user.id,
                        activityType: IpActivityType.DEPOSIT,
                        metadata: {
                            amount,
                            method,
                            orderId: deposit.orderId,
                        },
                    });
                }

                return c.json(
                    {
                        success: true,
                    },
                    HTTP_STATUS.OK
                );
            }

            return apiError(c, "Invalid method", HTTP_STATUS.BAD_REQUEST);
        } catch (error) {
            logger.error(error);
            return apiError(
                c,
                "Internal server error",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    // !This route is meant to be hit by user who is applying for withdrawal (withdraw order is GENERATED here) Note: withdraw order will go in PROCESSING after being approved by admin
    // Demo accounts: instant SUCCESS, balance debit, no gateway / admin approval
    app.openapi(WithdrawRoute, async (c) => {
        try {
            const user = c.get("user");

            const { amount, method, cryptoChain, note, password } =
                c.req.valid("json");

            const passwordHash = createHash("md5")
                .update(password)
                .digest("hex");
            if (passwordHash !== user.password) {
                return apiError(
                    c,
                    "Incorrect password",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            if (amount > user.balance) {
                return apiError(
                    c,
                    "Insufficient balance",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            if (amount < (await Config.SystemSettings.getMinWithdrawAmount())) {
                return apiError(
                    c,
                    "Withdraw amount is less than the minimum required withdrawal amount",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            const maxWithdrawApplicationsPerDay =
                await Config.SystemSettings.getMaxWithdrawApplicationsPerDay();

            const startOfToday = new Date();
            startOfToday.setHours(0, 0, 0, 0);

            const endOfToday = new Date();
            endOfToday.setHours(23, 59, 59, 999);

            const totalWithdrawApplicationsToday = await prisma.withdraw.count({
                where: {
                    userId: user.id,
                    createdAt: {
                        gte: startOfToday,
                        lte: endOfToday,
                    },
                },
            });

            if (
                totalWithdrawApplicationsToday >= maxWithdrawApplicationsPerDay
            ) {
                return apiError(
                    c,
                    "You have reached the maximum number of withdraw applications per day",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            // ── Demo account: instant SUCCESS withdraw, no gateway / admin ──
            if (user.isDemo) {
                let usdtAmount: number | undefined;
                if (method === "OXAPAY") {
                    if (
                        !cryptoChain ||
                        (cryptoChain !== "BEP20" && cryptoChain !== "TRC20")
                    ) {
                        return apiError(
                            c,
                            "Crypto chain (BEP20 or TRC20) is required for OXAPAY withdrawal",
                            HTTP_STATUS.BAD_REQUEST
                        );
                    }
                    const rate =
                        await Config.SystemSettings.getInrToUsdtWithdrawalConversionRate();
                    usdtAmount = amount / rate;
                    const minUsdt =
                        cryptoChain === "BEP20"
                            ? Config.MIN_USDT_WITHDRAW_BEP20
                            : Config.MIN_USDT_WITHDRAW_TRC20;
                    if (usdtAmount < minUsdt) {
                        const minInr = Math.ceil(minUsdt * rate);
                        return apiError(
                            c,
                            `Minimum ${cryptoChain} withdrawal is ${minUsdt} USDT (≈ ₹${minInr})`,
                            HTTP_STATUS.BAD_REQUEST
                        );
                    }
                }

                const withdrawAmount = Math.floor(amount);
                const orderId = generateOrderId();

                const { updatedUser, withdrawal } = await prisma.$transaction(
                    async (tx) => {
                        const updatedUser = await tx.user.update({
                            where: { id: user.id },
                            data: { balance: { decrement: withdrawAmount } },
                            select: { balance: true },
                        });

                        const withdrawal = await tx.withdraw.create({
                            data: {
                                userId: user.id,
                                amount: withdrawAmount,
                                method,
                                cryptoChain:
                                    method === "OXAPAY" ? cryptoChain : undefined,
                                usdtAmount,
                                status: WithdrawOrderStatus.SUCCESS,
                                orderId,
                                note: note ?? "PAYMENT SUCCESS",
                                metadata: {
                                    demo: true,
                                    dummy: true,
                                    note: "PAYMENT SUCCESS",
                                },
                            },
                        });

                        return { updatedUser, withdrawal };
                    }
                );

                if (user.hasIllegalBetPenalty) {
                    await prisma.user.update({
                        where: { id: user.id },
                        data: {
                            hasIllegalBetPenalty: false,
                            illegalBetPenaltyFactor: null,
                        },
                    });
                }

                WebSocketManager.publishToUser(user.id, "account-balance", {
                    balance: updatedUser.balance,
                });

                await invalidateUserWithdrawCache(user.id);

                const ip = getClientIp(c);
                if (ip) {
                    logIpActivity({
                        ip,
                        userId: user.id,
                        activityType: IpActivityType.WITHDRAWAL,
                        metadata: {
                            amount: withdrawAmount,
                            method,
                            orderId: withdrawal.orderId,
                            demo: true,
                        },
                    });
                }

                logger.info(
                    `[DEMO_WITHDRAW] user=${user.id} amount=${withdrawAmount} method=${method} order=${withdrawal.orderId}`
                );

                return c.json({ success: true }, HTTP_STATUS.OK);
            }

            const wagerStatus = await getUserWagerStatus(user.id);

            if (wagerStatus.isWithdrawalFrozen || wagerStatus.totalNeedToBet > 0) {
                return apiError(
                    c,
                    `Withdrawal is frozen until wager requirement of ₹${wagerStatus.totalNeedToBet} is completed`,
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            // const userBank = user.bank
            const userBank = await prisma.bank.findUnique({
                where: {
                    userId: user.id,
                },
            });

            let usdtForOrder: number | undefined;

            if (
                (method === "CXPAY" || method === "XDPAY") &&
                (!userBank ||
                    !userBank.bankAccount ||
                    !userBank.fullName ||
                    !userBank.ifsc)
            ) {
                return apiError(
                    c,
                    `Essential user bank details like bank account, full name and IFSC code are required for ${method} withdrawal. Please update your bank details`,
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            if (
                (method === "CXPAY" || method === "XDPAY") &&
                userBank &&
                (!isValidBankAccount(userBank.bankAccount) ||
                    !isValidRecipientName(userBank.fullName) ||
                    !isValidIfsc(userBank.ifsc))
            ) {
                return apiError(
                    c,
                    "Saved bank details have an invalid account number, recipient name or IFSC. Please correct them before withdrawing.",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            if (method === "OXAPAY") {
                if (!cryptoChain || (cryptoChain !== "BEP20" && cryptoChain !== "TRC20")) {
                    return apiError(
                        c,
                        "Crypto chain (BEP20 or TRC20) is required for OXAPAY withdrawal",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }
                const cryptoAddress = cryptoChain === "BEP20" ? userBank?.bep20Address : userBank?.trc20Address;
                if (!userBank || !cryptoAddress) {
                    return apiError(
                        c,
                        `${cryptoChain} address is required for OXAPAY withdrawal. Please update your bank details`,
                        HTTP_STATUS.BAD_REQUEST
                    );
                }
                const cryptoAddressValid =
                    cryptoChain === "BEP20"
                        ? isValidBep20Address(cryptoAddress)
                        : isValidTrc20Address(cryptoAddress);
                if (!cryptoAddressValid) {
                    return apiError(
                        c,
                        `Saved ${cryptoChain} address is invalid. Please correct it before withdrawing.`,
                        HTTP_STATUS.BAD_REQUEST
                    );
                }

                // Min USDT: BEP20 = $5, TRC20 = 100 USDT (amount is INR → convert via withdrawal rate)
                const rate =
                    await Config.SystemSettings.getInrToUsdtWithdrawalConversionRate();
                usdtForOrder = amount / rate;
                const minUsdt =
                    cryptoChain === "BEP20"
                        ? Config.MIN_USDT_WITHDRAW_BEP20
                        : Config.MIN_USDT_WITHDRAW_TRC20;
                if (usdtForOrder < minUsdt) {
                    const minInr = Math.ceil(minUsdt * rate);
                    return apiError(
                        c,
                        `Minimum ${cryptoChain} withdrawal is ${minUsdt} USDT (≈ ₹${minInr})`,
                        HTTP_STATUS.BAD_REQUEST
                    );
                }
            }

            if (method === "UPI" && (!userBank || !userBank.upiId)) {
                return apiError(
                    c,
                    "UPI ID is required for UPI withdrawal. Please update your bank details",
                    HTTP_STATUS.BAD_REQUEST
                );
            }
            if (method === "UPI" && !isValidUpiId(userBank?.upiId)) {
                return apiError(
                    c,
                    "Saved UPI ID is invalid. Please correct it before withdrawing.",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            const { updatedUser, withdrawal } = await prisma.$transaction(
                async (tx) => {
                    const updatedUser = await tx.user.update({
                        where: { id: user.id },
                        data: { balance: { decrement: amount } },
                        select: {
                            balance: true,
                        },
                    });

                    const withdrawal = await tx.withdraw.create({
                        data: {
                            userId: user.id,
                            amount,
                            method,
                            cryptoChain: method === "OXAPAY" ? cryptoChain : undefined,
                            usdtAmount: usdtForOrder,
                            status: "GENERATED",
                            orderId: generateOrderId(),
                            note,
                        },
                    });

                    return { updatedUser, withdrawal };
                }
            );

            if (user.hasIllegalBetPenalty) {
                await prisma.user.update({
                    where: { id: user.id },
                    data: {
                        hasIllegalBetPenalty: false,
                        illegalBetPenaltyFactor: null,
                    },
                });
            }

            WebSocketManager.publishToUser(user.id, "account-balance", {
                balance: updatedUser.balance,
            });

            await invalidateUserWithdrawCache(user.id);

            // Log IP activity for withdrawal
            const ip = getClientIp(c);
            if (ip) {
                logIpActivity({
                    ip,
                    userId: user.id,
                    activityType: IpActivityType.WITHDRAWAL,
                    metadata: {
                        amount,
                        method,
                        orderId: withdrawal.orderId,
                    },
                });
            }

            return c.json(
                {
                    success: true,
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

    app.openapi(CancelWithdrawRoute, async (c) => {
        try {
            const user = c.get("user");
            const { orderId } = c.req.valid("json");

            const withdraw = await prisma.withdraw.findFirst({
                where: {
                    orderId,
                    userId: user.id,
                    status: WithdrawOrderStatus.GENERATED,
                },
            });

            if (!withdraw) {
                return apiError(
                    c,
                    "No pending withdrawal found with the provided orderId",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            const { updatedUser } = await prisma.$transaction(async (tx) => {
                await tx.withdraw.update({
                    where: { id: withdraw.id },
                    data: { status: WithdrawOrderStatus.USER_CANCELED },
                });

                const updatedUser = await tx.user.update({
                    where: { id: user.id },
                    data: { balance: { increment: withdraw.amount } },
                    select: { balance: true },
                });

                return { updatedUser };
            });

            WebSocketManager.publishToUser(user.id, "account-balance", {
                balance: updatedUser.balance,
            });

            await invalidateUserWithdrawCache(user.id);

            return c.json(
                {
                    success: true,
                    message: "Withdrawal request cancelled successfully and amount refunded to your balance",
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
