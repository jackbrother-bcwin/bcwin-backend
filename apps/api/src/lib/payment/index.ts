export { default as Cxpay, CxpayServiceUnavailableError } from "./cxpay";
export { default as Xdpay, XdpayServiceUnavailableError } from "./xdpay";
export { default as Oxapay, OxapayServiceUnavailableError } from "./oxapay";

export const generateOrderId = () => {
    const date = new Date();

    const time =
        date.getUTCFullYear().toString() +
        String(date.getUTCMonth() + 1).padStart(2, "0") +
        String(date.getUTCDate()).padStart(2, "0");

    const random = Math.floor(10000000000000 + Math.random() * 90000000000000);

    return `${time}-${random}`;
};
