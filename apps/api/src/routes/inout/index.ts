import { OpenAPIHono } from "@hono/zod-openapi";

import { zodErrorHook } from "@/lib/utils";
import { launchRoutes } from "./launch";
import { gamesListRoutes } from "./gamesList";

/**
 * Public Inout routes — game catalog is safe to list without auth
 * so the home lobby can render tiles for guests and after cold start.
 */
export const inoutPublicRoutes = (app: OpenAPIHono) => {
    const inoutApp = new OpenAPIHono({ defaultHook: zodErrorHook });
    gamesListRoutes(inoutApp);
    app.route("/inout", inoutApp);
};

/**
 * Private Inout routes — launch requires authenticated user.
 */
export const inoutPrivateRoutes = (app: OpenAPIHono) => {
    const inoutApp = new OpenAPIHono({ defaultHook: zodErrorHook });
    launchRoutes(inoutApp);
    app.route("/inout", inoutApp);
};

/** @deprecated use inoutPublicRoutes + inoutPrivateRoutes */
export const inoutRoutes = (app: OpenAPIHono) => {
    inoutPublicRoutes(app);
    inoutPrivateRoutes(app);
};
