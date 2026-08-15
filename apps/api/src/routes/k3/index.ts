import { OpenAPIHono } from "@hono/zod-openapi";

import { zodErrorHook } from "@/lib/utils";
import { periodRoutes } from "./periods";
import { betRoutes } from "./bets";
import { resultRoutes } from "./results";

export const k3Routes = (app: OpenAPIHono) => {
    const k3App = new OpenAPIHono({ defaultHook: zodErrorHook });

    periodRoutes(k3App);
    betRoutes(k3App);
    resultRoutes(k3App);

    app.route("/k3", k3App);
};
