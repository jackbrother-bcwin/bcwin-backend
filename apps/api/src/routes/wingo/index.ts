import { OpenAPIHono } from "@hono/zod-openapi";

import { zodErrorHook } from "@/lib/utils";
import { periodRoutes } from "./periods";
import { betRoutes } from "./bets";
import { resultRoutes } from "./results";

export const wingoRoutes = (app: OpenAPIHono) => {
    const wingoApp = new OpenAPIHono({ defaultHook: zodErrorHook });

    periodRoutes(wingoApp);
    betRoutes(wingoApp);
    resultRoutes(wingoApp);

    app.route("/wingo", wingoApp);
};
