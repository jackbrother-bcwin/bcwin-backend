import { OpenAPIHono } from "@hono/zod-openapi";

import { zodErrorHook } from "@/lib/utils";
import { cxpayCallbackRoutes } from "./payment/cxpay";
import { xdpayCallbackRoutes } from "./payment/xdpay";
import { oxapayCallbackRoutes } from "./payment/oxapay";
import { inoutCallbackRoutes } from "./vendor/inout";

export const callbackRoutes = (app: OpenAPIHono) => {
    const callbackApp = new OpenAPIHono({ defaultHook: zodErrorHook });

    cxpayCallbackRoutes(callbackApp);
    xdpayCallbackRoutes(callbackApp);
    oxapayCallbackRoutes(callbackApp);
    inoutCallbackRoutes(callbackApp);

    app.route("/callback", callbackApp);
};
