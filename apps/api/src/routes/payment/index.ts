import { OpenAPIHono } from "@hono/zod-openapi";

import { zodErrorHook } from "@/lib/utils";
import { bankRoutes } from "./bank";
import { paymentRoutes as paymentPaymentRoutes } from "./payment";

export const paymentRoutes = (app: OpenAPIHono) => {
    const paymentApp = new OpenAPIHono({ defaultHook: zodErrorHook });

    bankRoutes(paymentApp);
    paymentPaymentRoutes(paymentApp);

    app.route("/payment", paymentApp);
};
