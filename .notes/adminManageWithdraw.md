Study the current codebase for coding practices and style and follow the same style. Study the payment/payment.ts file to get how withdraw is being initiated.

Implement withdraw.ts file in admin/manage folder. This file will contain two routes /admin/withdraw/list and /admin/withdraw/manage.
the list route will list the withdraws. it will take in pagination options and also status to filter out withdraws according to status. checkout schemas/commission.ts to get how pagination will work with page and limit.
the manage route will be like following example.


Following is example for accepting and rejecting withdraw (keep in mind we do not have any concept of withdraw method being offline... currently we only have method as CXPAY)
```
import { Mode, WithdrawOrderStatus } from "@prisma/client";

import db from "@/lib/db";
import { status } from "@/lib/http";
import { Method, WithdrawMethod } from "@/lib/payment";
import { APIError, handleError } from "@/lib/error";
import Okpay from "@/vendor/payment/okpay";
import Wepay from "@/vendor/payment/wepay";
import Cxpay from "@/vendor/payment/cxpay";
import Payx from "@/vendor/payment/payx";
import Payx2 from "@/vendor/payment/payx2";

const Action = {
    approve: "approve",
    reject: "reject",
};

export const GET = async (req: Request) => {
    try {
        const { searchParams } = new URL(req.url);
        const action = searchParams.get("action");
        const orderId = searchParams.get("orderId");
        const withdrawMethod = searchParams.get("method");

        if (!action) {
            return APIError("action is required", status.BAD_REQUEST);
        }

        if (!orderId) {
            return APIError("orderId is required", status.BAD_REQUEST);
        }

        if (!Object.values(Action).includes(action)) {
            return APIError(
                `Invalid action. Valid actions are ${Object.values(Action)}`,
                status.BAD_REQUEST
            );
        }

        const withdraw = await db.withdraw.findUnique({
            where: {
                orderId,
                status: WithdrawOrderStatus.GENERATED,
            },
        });

        if (!withdraw) {
            return APIError(
                "No withdraw found in GENERATED state with provided orderId",
                status.BAD_REQUEST
            );
        }

        if (action == Action.reject) {
            await db.withdraw.update({
                where: {
                    orderId,
                },
                data: {
                    status: WithdrawOrderStatus.FAILED,
                },
            });

            await db.user.update({
                where: {
                    id: withdraw.userId,
                },
                data: {
                    balance: {
                        increment: withdraw.amount,
                    },
                },
            });

            return Response.json({ message: "success" });
        }

        if (!withdrawMethod) {
            return APIError("method is required", status.BAD_REQUEST);
        }

        if (!Object.values(Method).includes(withdrawMethod)) {
            return APIError(
                `Invalid method. Valid methods are ${Object.values(Method)}`,
                status.BAD_REQUEST
            );
        }

        if (withdraw.method == WithdrawMethod.bank) {
            if (withdrawMethod !== Method.offline) {
                const userBank = await db.bank.findUnique({
                    where: {
                        userId: withdraw.userId,
                    },
                });

                if (!userBank) {
                    return APIError(
                        "User bank details not found",
                        status.BAD_REQUEST
                    );
                }

                if (withdrawMethod == Method.okpay) {
                    const okpayResp = await Okpay.initiateWithdrawl(
                        withdraw.amount,
                        userBank.bankAccount,
                        userBank.fullName,
                        userBank.ifsc,
                        orderId
                    );

                    if (okpayResp.code != 0) {
                        console.error("[API_ADMIN_WITHDRAW_OKPAY]:", okpayResp);

                        return APIError(
                            `Unable to initiate withdraw at the moment. ${okpayResp.msg}`,
                            status.SERVICE_UNAVAILABLE
                        );
                    }
                } else if (withdrawMethod == Method.cxpay) {
                    const cxpayResp = await Cxpay.initiateWithdrawl(
                        withdraw.amount,
                        userBank.bankAccount,
                        userBank.fullName,
                        userBank.ifsc,
                        orderId
                    );

                    if (cxpayResp.code !== 200 && !cxpayResp.success) {
                        console.error("[API_ADMIN_WITHDRAW_CXPAY]:", cxpayResp);

                        return APIError(
                            `Unable to initiate withdraw at the moment. ${cxpayResp.msg}`,
                            status.SERVICE_UNAVAILABLE
                        );
                    }
                } else if (withdrawMethod === Method.payx) {
                    const payxResp = await Payx.initiateWithdrawl (
                        withdraw.amount,
                        userBank.bankAccount,
                        userBank.fullName,
                        userBank.ifsc,
                        orderId,
                    )

                    if(payxResp.code !== 0) {
                        console.error("[API_ADMIN_WITHDRAW_PAYX]:", payxResp);

                        return APIError(
                            `Unable to initiate withdraw at the moment. ${payxResp.msg}`,
                            status.SERVICE_UNAVAILABLE
                        );
                    }
                } else if(withdrawMethod === Method.payx2) {
                    const payxResp2 = await Payx2.initiateWithdrawl (
                        withdraw.amount,
                        userBank.bankAccount,
                        userBank.fullName,
                        userBank.ifsc,
                        orderId,
                    )

                    if(payxResp2.code !== 0) {
                        console.error("[API_ADMIN_WITHDRAW_PAYX2]:", payxResp2);

                        return APIError(
                            `Unable to initiate withdraw at the moment. ${payxResp2.msg}`,
                            status.SERVICE_UNAVAILABLE
                        );
                    }
                } else if (withdrawMethod == Method.wepay) {
                    const wepayResp = await Wepay.initiateWithdrawl(
                        withdraw.amount,
                        userBank.bankAccount,
                        userBank.fullName,
                        userBank.ifsc,
                        orderId
                    );

                    if (wepayResp.code !== 200 && !wepayResp.success) {
                        console.error("[API_ADMIN_WITHDRAW_WEPAY]:", wepayResp);

                        return APIError(
                            `Unable to initiate withdraw at the moment. ${wepayResp.msg}`,
                            status.SERVICE_UNAVAILABLE
                        );
                    }
                }
            } else {
                const withdraw = await db.withdraw.findUnique({
                    where: {
                        orderId,
                        user: {
                            mode: Mode.OFFLINE,
                        },
                    },
                });

                if (!withdraw) {
                    return APIError(
                        "No withdraw order found for this offline user",
                        status.BAD_REQUEST
                    );
                }

                await db.withdraw.update({
                    where: {
                        orderId,
                    },
                    data: {
                        status: WithdrawOrderStatus.SUCCESS,
                    },
                });

                return Response.json({ message: "success" });
            }

            await db.withdraw.update({
                where: {
                    orderId,
                },
                data: {
                    status: WithdrawOrderStatus.PROCESSING,
                },
            });

            return Response.json({ message: "success" });
        }

        return APIError(
            `Order has unknown withdraw method. ${withdraw.method}`,
            status.BAD_REQUEST
        );
    } catch (error) {
        return handleError("API_ADMIN_WITHDRAW", error);
    }
};
```