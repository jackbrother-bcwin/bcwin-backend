import { OpenAPIHono } from "@hono/zod-openapi";

import { zodErrorHook } from "@/lib/utils";
import { commissionRateRoutes } from "./commissionRate";
import { systemConfigRoutes } from "./config";
import { notificationRoutes } from "./notification";

export const configRoutes = (app: OpenAPIHono) => {
    // Mount system config routes under /admin/config
    systemConfigRoutes(app);

    // Mount commission rate routes under /admin/config/commission-rates
    const commissionRateApp = new OpenAPIHono({ defaultHook: zodErrorHook });
    commissionRateRoutes(commissionRateApp);
    app.route("/commission-rates", commissionRateApp);

    // Mount notification routes under /admin/config/notifications
    const notificationApp = new OpenAPIHono({ defaultHook: zodErrorHook });
    notificationRoutes(notificationApp);
    app.route("/notifications", notificationApp);
};
