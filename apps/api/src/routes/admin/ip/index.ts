import { OpenAPIHono } from "@hono/zod-openapi";

import { ipManagementRoutes } from "./management";
import { ipStatisticsRoutes } from "./statistics";

export const ipRoutes = (app: OpenAPIHono) => {
    // Mount IP management routes
    ipManagementRoutes(app);

    // Mount IP statistics routes
    ipStatisticsRoutes(app);
};
