import { HTTP_STATUS } from "@/lib/http";
import * as Config from "@bcwin/config";
import crypto from "crypto";

export class XdpayServiceUnavailableError extends Error {
    statusCode = HTTP_STATUS.SERVICE_UNAVAILABLE;
    responseBody?: string;

    constructor(responseBody?: string, status?: number) {
        super(`Unable to connect to xdpay: HTTP ${status || "unknown"}`);
        this.responseBody = responseBody;

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, XdpayServiceUnavailableError);
        }

        this.name = this.constructor.name;
    }
}

class xdpay {
    static #TEST_CHANNEL = "101";

    // collection channels (payment channels)
    static #INDIAN_COLLECTION_CHANNEL = "13701";

    // payment channels (withdraw channels)
    static #INDIAN_PAYMENT_CHANNEL = "13702";

    static #paymentNotifyUrl = Config.env.XDPAY_PAYMENT_NOTIFICATION_URL;
    static #withdrawNotifyUrl = Config.env.XDPAY_WITHDRAW_NOTIFICATION_URL;

    // merchant data
    static #mchId = Config.env.XDPAY_MERCHANT_ID;
    static #key = Config.env.XDPAY_MERCHANT_KEY;

    static #TEST_MODE = false;

    /**
     *
     * @param {boolean} test
     */
    static setTestMode(test: boolean) {
        xdpay.#TEST_MODE = test ? true : false;
    }

    /**
     * Initiate payment to xdpay systems
     * @param {string} amount payment amount
     * @param {string} orderId merchant order number
     */
    static async initiatePayment(amount: string, orderId: string) {
        const REQ_URL = "https://apis.xdpay168.com/client/collect/create";

        const CHANNEL_ID = xdpay.#TEST_MODE
            ? xdpay.#TEST_CHANNEL
            : xdpay.#INDIAN_COLLECTION_CHANNEL;

        const signStr =
            `amount=${amount}&` +
            `merchant=${xdpay.#mchId}&` +
            `notifyUrl=${xdpay.#paymentNotifyUrl}&` +
            `orderId=${orderId}&` +
            `payCode=${CHANNEL_ID}&` +
            `key=${xdpay.#key}`;

        const sign = xdpay.#sign(signStr);

        const data = {
            merchant: xdpay.#mchId,
            payCode: CHANNEL_ID,
            amount,
            orderId,
            notifyUrl: xdpay.#paymentNotifyUrl,
            sign,
        };

        return await xdpay.#get(REQ_URL, JSON.stringify(data));
    }

    /**
     * Initiate withdrawl from xdpay's systems
     * @param {string} amount amount to withdraw
     * @param {string} bankAccount Bank account number
     * @param {string} customName Name of account holder
     * @param {string} remark IFSC code
     * @param {string} orderId merchant order number
     */
    static async initiateWithdrawl(
        amount: string,
        bankAccount: string,
        customName: string,
        remark: string,
        orderId: string
    ) {
        const REQ_URL = "https://apis.xdpay168.com/client/pay/create";

        const CHANNEL_ID = xdpay.#TEST_MODE
            ? xdpay.#TEST_CHANNEL
            : xdpay.#INDIAN_PAYMENT_CHANNEL;

        const signStr =
            `amount=${amount}&` +
            `bankAccount=${bankAccount}&` +
            `customName=${customName}&` +
            `merchant=${xdpay.#mchId}&` +
            `notifyUrl=${xdpay.#withdrawNotifyUrl}&` +
            `orderId=${orderId}&` +
            `payCode=${CHANNEL_ID}&` +
            `remark=${remark}&` +
            `key=${xdpay.#key}`;

        const sign = xdpay.#sign(signStr);

        const data = {
            bankAccount,
            customName,
            merchant: xdpay.#mchId,
            remark,
            payCode: CHANNEL_ID,
            amount,
            orderId,
            notifyUrl: xdpay.#withdrawNotifyUrl,
            sign,
        };

        return await xdpay.#get(REQ_URL, JSON.stringify(data));
    }

    /**
     *
     * @param {*} data data sent by xdpay's systems
     * @returns {boolean} `true` if verification is passed else `false`
     */
    static verify(data: any) {
        const signStr =
            `amount=${data.amount}&` +
            `orderId=${data.orderId}&` +
            `platOrderId=${data.platOrderId}&` +
            (data.remark == undefined ? "" : `remark=${data.remark}&`) +
            (data.reverse == undefined ? "" : `reverse=${data.reverse}&`) +
            `status=${data.status}&` +
            `key=${xdpay.#key}`;

        return xdpay.#sign(signStr) == data.sign;
    }

    /**
     *
     * @param {string} data data to sign
     */
    static #sign(data: string) {
        return crypto.createHash("md5").update(data).digest("hex");
    }

    /**
     *
     * @param {string} reqUrl req url
     * @param {string} json json data
     */
    static async #get(reqUrl: string, json: string) {
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
            throw new XdpayServiceUnavailableError(body, response.status);
        }

        return await response.json();
    }

    /**
     * Type guard helper to validate callback payload structure
     */
    static isXdpayCallbackData(data: any): boolean {
        return (
            typeof data === "object" &&
            data !== null &&
            typeof data.platOrderId === "string" &&
            typeof data.orderId === "string" &&
            (typeof data.amount === "number" || typeof data.amount === "string") &&
            (typeof data.status === "number" || typeof data.status === "string") &&
            typeof data.sign === "string"
        );
    }
}

if (Config.env.XDPAY_TEST_MODE) {
    xdpay.setTestMode(true);
}

export default xdpay;