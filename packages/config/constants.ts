export const PAYMENT_METHODS = ["CXPAY", "XDPAY", "UPI", "OXAPAY"] as const;
export const WITHDRAW_METHODS = ["CXPAY", "XDPAY", "UPI", "OXAPAY"] as const;

/** Minimum USDT amount for OXAPAY (crypto) withdrawals by chain */
export const MIN_USDT_WITHDRAW_BEP20 = 5;
export const MIN_USDT_WITHDRAW_TRC20 = 100;

/**
 * Lifetime SUCCESS deposit (INR principal) required to play
 * Inout + first-party lottery (Wingo / TRX / K3 / 5D / Moto).
 */
export const GAME_MIN_LIFETIME_DEPOSIT = 100;

/** Successful gift redeems per user per IST calendar day (00:00–24:00). */
export const GIFT_CLAIMS_PER_IST_DAY = 3;
