import { OpenAPIHono } from "@hono/zod-openapi";

import { listRoutes } from "./list";
import { createRoutes } from "./create";
import { agentPerformanceRoutes } from "./performance";
import { detailsRoutes } from "./details";

export const agentRoutes = (app: OpenAPIHono) => {
    listRoutes(app);
    createRoutes(app);
    detailsRoutes(app);
    agentPerformanceRoutes(app);
};
