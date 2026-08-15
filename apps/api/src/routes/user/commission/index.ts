import { OpenAPIHono } from "@hono/zod-openapi";

import { zodErrorHook } from "@/lib/utils";
import { dailyCommissionRoutes } from "./daily";
import { breakdownRoutes } from "./breakdown";
import { rateRoutes } from "./rate";

export const commissionRoutes = (app: OpenAPIHono) => {
    const commissionApp = new OpenAPIHono({ defaultHook: zodErrorHook });

    dailyCommissionRoutes(commissionApp);
    breakdownRoutes(commissionApp);
    rateRoutes(commissionApp);

    app.route("/commission", commissionApp);
};
