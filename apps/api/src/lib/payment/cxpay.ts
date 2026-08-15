import { HTTP_STATUS } from "@/lib/http";
import * as Config from "@bcwin/config";
import crypto from "crypto";

export class CxpayServiceUnavailableError extends Error {
    statusCode = HTTP_STATUS.SERVICE_UNAVAILABLE;
    responseBody?: string;

    constructor(responseBody?: string, status?: number) {
        super(`Unable to connect to cxpay: HTTP ${status || "unknown"}`);
        this.responseBody = responseBody;

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, CxpayServiceUnavailableError);
        }

        this.name = this.constructor.name;
    }
}

interface CxpayData {
    platOrderId: string;
    orderId: string;
    amount: number;
    status: number;
    reverse: boolean;
    remark: string;
    fee?: number;
    sign: string;
}

class Cxpay {
    static #BASE_URL = "https://apis.cxpay168.com/client";
    static #TEST_MODE = false;

    static #withdrawPayCode = Config.env.CXPAY_WITHDRAW_PAY_CODE;
    static #paymentPayCode = Config.env.CXPAY_PAYMENT_PAY_CODE;
    static #testPayCode = Config.env.CXPAY_TEST_PAY_CODE;
    static #paymentNotifyUrl = Config.env.CXPAY_PAYMENT_NOTIFICATION_URL;
    static #paymentReturnUrl = Config.env.CXPAY_PAYMENT_RETURN_URL;
    static #withdrawNotifyUrl = Config.env.CXPAY_WITHDRAW_NOTIFICATION_URL;
    static #merchantKey = Config.env.CXPAY_MERCHANT_KEY;
    static #merchantId = Config.env.CXPAY_MERCHANT_ID;

    static setTestMode(test: boolean) {
        Cxpay.#TEST_MODE = test;
    }

    static async initiatePayment(
        amount: number,
        orderId: string,
    ) {
        const payCode = Cxpay.#TEST_MODE
            ? Cxpay.#testPayCode
            : Cxpay.#paymentPayCode

        const data = {
            merchant: Cxpay.#merchantId,
            payCode,
            amount: amount,
            orderId: orderId,
            notifyUrl: Cxpay.#paymentNotifyUrl,
            callbackUrl: Cxpay.#paymentReturnUrl,
            sign: Cxpay.#signPaymentData(amount, orderId, payCode),
        };

        return await Cxpay.#makePostRequest(
            `${Cxpay.#BASE_URL}/collect/create`,
            JSON.stringify(data)
        );
    }

    static async initiateWithdrawl(
        amount: number,
        bankAccount: string,
        customName: string,
        ifsc: string,
        orderId: string
    ) {
        const payCode = Cxpay.#TEST_MODE
            ? Cxpay.#testPayCode
            : Cxpay.#withdrawPayCode;
        const data = {
            merchant: Cxpay.#merchantId,
            payCode: payCode,
            amount: amount,
            orderId: orderId,
            notifyUrl: Cxpay.#withdrawNotifyUrl,
            bankAccount: bankAccount,
            customName: customName,
            remark: ifsc,
            sign: Cxpay.#signWithdrawData(
                amount,
                bankAccount,
                customName,
                ifsc,
                orderId,
                payCode
            ),
        };

        return await Cxpay.#makePostRequest(
            `${Cxpay.#BASE_URL}/pay/create`,
            JSON.stringify(data)
        );
    }

    static verify(data: CxpayData): boolean {
        const signStr = `amount=${data.amount}${data.fee ? `&fee=${data.fee}&` : ""
            }&orderId=${data.orderId}&platOrderId=${data.platOrderId}&remark=${data.remark
            }&reverse=${data.reverse}&status=${data.status}&key=${Cxpay.#merchantKey
            }`;

        return Cxpay.#sign(signStr) === data.sign;
    }

    static #signPaymentData(
        amount: number,
        orderId: string,
        payCode: string
    ): string {
        const signStr = `amount=${amount}&callbackUrl=${Cxpay.#paymentReturnUrl
            }&merchant=${Cxpay.#merchantId}&notifyUrl=${Cxpay.#paymentNotifyUrl
            }&orderId=${orderId}&payCode=${payCode}&key=${Cxpay.#merchantKey}`;
        return Cxpay.#sign(signStr);
    }

    static #signWithdrawData(
        amount: number,
        bankAccount: string,
        customName: string,
        ifsc: string,
        orderId: string,
        payCode: string
    ): string {
        const signStr = `amount=${amount}&bankAccount=${bankAccount}&customName=${customName}&merchant=${Cxpay.#merchantId
            }&notifyUrl=${Cxpay.#withdrawNotifyUrl}&orderId=${orderId}&payCode=${payCode
            }&remark=${ifsc}&key=${Cxpay.#merchantKey}`;
        return Cxpay.#sign(signStr);
    }

    static #sign(data: string): string {
        return crypto
            .createHash("md5")
            .update(data)
            .digest("hex")
            .toLowerCase();
    }

    static isCxpayCallbackData(data: any): data is CxpayData {
        return (
            typeof data === "object" &&
            typeof data.platOrderId === "string" &&
            typeof data.orderId === "string" &&
            typeof data.amount === "number" &&
            typeof data.status === "number" &&
            typeof data.reverse === "boolean" &&
            typeof data.remark === "string" &&
            (typeof data.fee === "number" || typeof data.fee === "undefined") &&
            typeof data.sign === "string"
        );
    }

    static async #makePostRequest(reqUrl: string, json: string): Promise<any> {
        const postHeaders = {
            "Content-Type": "application/json",
            Charset: "utf-8",
            "Content-Length": json.length.toString(),
        };

        const response = await fetch(reqUrl, {
            method: "POST",
            body: json,
            headers: postHeaders,
        });

        if (!response.ok) {
            const body = await response.text();
            throw new CxpayServiceUnavailableError(body, response.status);
        }

        return await response.json();
    }
}

if (Config.env.CXPAY_TEST_MODE) {
    Cxpay.setTestMode(true);
}

export default Cxpay;
