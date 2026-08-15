import { OpenAPIHono } from "@hono/zod-openapi";

import { zodErrorHook } from "@/lib/utils";
import { periodRoutes } from "./periods";
import { betRoutes } from "./bets";
import { resultRoutes } from "./results";

export const motoRoutes = (app: OpenAPIHono) => {
    const motoApp = new OpenAPIHono({ defaultHook: zodErrorHook });

    periodRoutes(motoApp);
    betRoutes(motoApp);
    resultRoutes(motoApp);

    app.route("/moto", motoApp);
};
