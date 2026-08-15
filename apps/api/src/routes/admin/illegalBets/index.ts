import { OpenAPIHono } from "@hono/zod-openapi";

import { illegalBetsRoutes } from "./list";
import { illegalBetsStatisticsRoutes } from "./statistics";

export const illegalBetsManagementRoutes = (app: OpenAPIHono) => {
    // Mount illegal bets list routes
    illegalBetsRoutes(app);

    // Mount illegal bets statistics routes
    illegalBetsStatisticsRoutes(app);
};
