import { z } from "zod";

const envSchema = z.object({
    // Server
    PORT: z.coerce.number().default(3000),
    DOMAIN: z.string().default("http://localhost:3000"),

    // CXPAY
    CXPAY_PAYMENT_NOTIFICATION_URL: z.url(),
    CXPAY_PAYMENT_RETURN_URL: z.url(),
    CXPAY_WITHDRAW_NOTIFICATION_URL: z.url(),
    CXPAY_WITHDRAW_PAY_CODE: z.string(),
    CXPAY_MERCHANT_KEY: z.string(),
    CXPAY_MERCHANT_ID: z.string(),
    CXPAY_TEST_PAY_CODE: z.string(),
    CXPAY_PAYMENT_PAY_CODE: z.string(),
    CXPAY_TEST_MODE: z.coerce.boolean().default(false),

    // XDPAY
    XDPAY_PAYMENT_NOTIFICATION_URL: z.url(),
    XDPAY_WITHDRAW_NOTIFICATION_URL: z.url(),
    XDPAY_MERCHANT_ID: z.string(),
    XDPAY_MERCHANT_KEY: z.string(),
    XDPAY_TEST_MODE: z.coerce.boolean().default(false),

    // OXAPAY
    OXAPAY_MERCHANT_API_KEY: z.string(),
    OXAPAY_PAYOUT_API_KEY: z.string(),
    OXAPAY_PAYMENT_NOTIFICATION_URL: z.url(),
    OXAPAY_WITHDRAW_NOTIFICATION_URL: z.url(),
    OXAPAY_PAYMENT_RETURN_URL: z.url().optional(),
    OXAPAY_TEST_MODE: z.coerce.boolean().default(false),

    // inout
    INOUT_OPERATOR_ID: z.string(),
    INOUT_SECRET_KEY: z.string(),

    // Otp
    LAAFIC_APPID: z.string(),
    LAAFFIC_APIKEY: z.string(),
    LAAFFIC_API_SECRET: z.string(),

    // Maileroo
    MAILEROO_API_KEY: z.string(),
    MAILEROO_FROM_EMAIL: z.string(),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
    console.error("❌ Invalid environment variables:", z.treeifyError(_env.error));
    process.exit(1);
}

export const env = _env.data;
