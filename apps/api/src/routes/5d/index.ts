import { OpenAPIHono } from "@hono/zod-openapi";

import { zodErrorHook } from "@/lib/utils";
import { periodRoutes } from "./periods";
import { betRoutes } from "./bets";
import { resultRoutes } from "./results";

export const fiveDRoutes = (app: OpenAPIHono) => {
    const fiveDApp = new OpenAPIHono({ defaultHook: zodErrorHook });

    periodRoutes(fiveDApp);
    betRoutes(fiveDApp);
    resultRoutes(fiveDApp);

    app.route("/5d", fiveDApp);
};
