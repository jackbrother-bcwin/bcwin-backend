import { OpenAPIHono } from "@hono/zod-openapi";

import { zodErrorHook } from "@/lib/utils";
import { rebateHistoryRoutes } from "./history";
import { rebateRatesRoutes } from "./rates";
import { rebateDailyRoutes } from "./daily";
import { rebateDayPreviewRoutes } from "./dayPreview";
import { rebateDayTotalsRoutes } from "./dayTotals";
import { rebatePeopleRoutes } from "./people";
import { selfRebateRoutes } from "./selfRebate";

export const rebateRoutes = (app: OpenAPIHono) => {
    const rebateApp = new OpenAPIHono({ defaultHook: zodErrorHook });

    rebateHistoryRoutes(rebateApp);
    rebateRatesRoutes(rebateApp);
    rebateDailyRoutes(rebateApp);
    rebateDayPreviewRoutes(rebateApp);
    rebateDayTotalsRoutes(rebateApp);
    rebatePeopleRoutes(rebateApp);
    selfRebateRoutes(rebateApp);

    app.route("/rebate", rebateApp);
};
