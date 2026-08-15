import { HTTP_STATUS } from "@/lib/http";
import * as Config from "@bcwin/config";
import crypto from "crypto";

export class OxapayServiceUnavailableError extends Error {
    statusCode = HTTP_STATUS.SERVICE_UNAVAILABLE;
    responseBody?: string;

    constructor(responseBody?: string, status?: number) {
        super(`Unable to connect to oxapay: HTTP ${status || "unknown"}`);
        this.responseBody = responseBody;

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, OxapayServiceUnavailableError);
        }

        this.name = this.constructor.name;
    }
}

export interface OxapayCallbackData {
    track_id: string;
    status: string;
    type: "invoice" | "payout" | "white_label" | "static_address" | "payment_link" | "donation";
    amount: number | string;
    currency: string;
    order_id?: string;
    tx_hash?: string;
    address?: string;
    network?: string;
    description?: string;
}

export class Oxapay {
    static #BASE_URL = "https://api.oxapay.com";
    static #TEST_MODE = false;

    static #merchantApiKey = Config.env.OXAPAY_MERCHANT_API_KEY;
    static #payoutApiKey = Config.env.OXAPAY_PAYOUT_API_KEY;
    static #paymentNotifyUrl = Config.env.OXAPAY_PAYMENT_NOTIFICATION_URL;
    static #paymentReturnUrl = Config.env.OXAPAY_PAYMENT_RETURN_URL;
    static #withdrawNotifyUrl = Config.env.OXAPAY_WITHDRAW_NOTIFICATION_URL;

    static setTestMode(test: boolean) {
        Oxapay.#TEST_MODE = test;
    }

    /**
     * Initiate payment (create invoice link) via OxaPay v1
     * @param {number} amount payment amount
     * @param {string} orderId merchant order number
     * @param {string} [currency] specific currency code
     * @param {string} [email] payer email
     * @param {string} [description] order description
     */
    static async initiatePayment(
        amount: number,
        orderId: string,
        currency: string = "USD",
        email?: string,
        description?: string
    ) {
        const REQ_URL = `${Oxapay.#BASE_URL}/v1/payment/invoice`;

        const data = {
            amount,
            currency,
            order_id: orderId,
            callback_url: Oxapay.#paymentNotifyUrl,
            return_url: Oxapay.#paymentReturnUrl,
            email,
            description,
            sandbox: Oxapay.#TEST_MODE,
        };

        const headers = {
            merchant_api_key: Oxapay.#merchantApiKey,
        };

        return await Oxapay.#makePostRequest(REQ_URL, JSON.stringify(data), headers);
    }

    /**
     * Initiate withdrawal (payout) via OxaPay v1
     * @param {number} amount amount to payout
     * @param {string} address recipient cryptocurrency address
     * @param {string} currency cryptocurrency symbol (e.g., USDT, BTC)
     * @param {string} network cryptocurrency network (e.g., TRON)
     * @param {string} [description] additional description
     */
    static async initiateWithdrawl(
        amount: number,
        address: string,
        currency: string,
        network: string,
        description?: string
    ) {
        const REQ_URL = `${Oxapay.#BASE_URL}/v1/payout`;

        const data = {
            address,
            currency,
            amount,
            network,
            callback_url: Oxapay.#withdrawNotifyUrl,
            description,
        };

        const headers = {
            payout_api_key: Oxapay.#payoutApiKey,
        };

        return await Oxapay.#makePostRequest(REQ_URL, JSON.stringify(data), headers);
    }

    /**
     * Verify callback authenticity using HMAC-SHA512
     * @param {string} rawBody raw string body of the request
     * @param {string} hmacHeader HMAC signature header received from OxaPay
     * @param {boolean} [isPayout] optionally specify if it is a payout callback to bypass auto-detection
     */
    static verify(
        rawBody: string,
        hmacHeader: string,
        isPayout?: boolean
    ): boolean {
        if (!hmacHeader) return false;

        let checkPayout = isPayout;
        if (checkPayout === undefined) {
            try {
                const parsed = JSON.parse(rawBody);
                checkPayout = parsed.type === "payout";
            } catch (err) {
                return false;
            }
        }

        const apiKey = checkPayout
            ? Oxapay.#payoutApiKey
            : Oxapay.#merchantApiKey;

        const calculatedHmac = crypto
            .createHmac("sha512", apiKey)
            .update(rawBody)
            .digest("hex");

        return calculatedHmac.toLowerCase() === hmacHeader.toLowerCase();
    }

    /**
     * Type guard helper to validate callback payload structure
     */
    static isOxapayCallbackData(data: any): data is OxapayCallbackData {
        return (
            typeof data === "object" &&
            data !== null &&
            typeof data.track_id === "string" &&
            typeof data.status === "string" &&
            typeof data.type === "string" &&
            (typeof data.amount === "number" || typeof data.amount === "string") &&
            typeof data.currency === "string"
        );
    }

    static async #makePostRequest(
        reqUrl: string,
        json: string,
        headers?: Record<string, string>
    ): Promise<any> {
        const postHeaders: Record<string, string> = {
            "Content-Type": "application/json",
            "Content-Length": json.length.toString(),
            ...headers,
        };

        const response = await fetch(reqUrl, {
            method: "POST",
            body: json,
            headers: postHeaders,
        });

        if (!response.ok) {
            const body = await response.text();
            throw new OxapayServiceUnavailableError(body, response.status);
        }

        return await response.json();
    }
}

if (Config.env.OXAPAY_TEST_MODE) {
    Oxapay.setTestMode(true);
}

export default Oxapay;
