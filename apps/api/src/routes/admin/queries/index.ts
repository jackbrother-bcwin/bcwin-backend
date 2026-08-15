import { OpenAPIHono } from "@hono/zod-openapi";

import { listQueriesRoutes } from "./list";
import { updateStatusRoutes } from "./updateStatus";

export const queriesRoutes = (app: OpenAPIHono) => {
    listQueriesRoutes(app);
    updateStatusRoutes(app);
};
