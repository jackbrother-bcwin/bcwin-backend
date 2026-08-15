import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";

import Logger from "@bcwin/logger";

import { authMiddleware, validateJsonBody, maintenanceMiddleware } from "./middleware";
import { zodErrorHook } from "./lib/utils";

import { authRoutes } from "./routes/auth";
import { basicRoutes } from "./routes/basic";
import { otpRoutes } from "./routes/otp";
import { userRoutes } from "./routes/user";
import { paymentRoutes } from "./routes/payment";
import { giftRoutes } from "./routes/gift/redeem";
import { adminRoutes } from "./routes/admin";
import { wingoRoutes } from "./routes/wingo";
import { motoRoutes } from "./routes/moto";
import { k3Routes } from "./routes/k3";
import { fiveDRoutes } from "./routes/5d";
import { trxwingoRoutes } from "./routes/trxwingo";
import { websocketRoutes } from "./routes/websocket";
import { callbackRoutes } from "./routes/callback";
import { inoutPrivateRoutes, inoutPublicRoutes } from "./routes/inout";
// import { commissionRoutes } from "./routes/user/commission";
// import { vipRoutes } from "./routes/user/vip";

export const registerRoutes = async (app: OpenAPIHono, mainLogger: Logger) => {
    if (process.env.NODE_ENV !== "production") {
        const { logger } = await import("hono/logger");
        mainLogger.info("Hono Logger enabled for development");

        app.use(logger());
    }

    // public routes
    const publicApp = new OpenAPIHono({
        defaultHook: zodErrorHook,
    });
    publicApp.use(validateJsonBody);

    basicRoutes(publicApp);
    otpRoutes(publicApp);
    websocketRoutes(publicApp);
    callbackRoutes(publicApp);
    // Inout game catalog (list) is public so home grids always populate
    inoutPublicRoutes(publicApp);

    const authApp = new OpenAPIHono({
        defaultHook: zodErrorHook,
    });
    authRoutes(authApp);
    publicApp.route("/auth", authApp);

    app.route("/api/v1", publicApp);

    // private routes (authorized routes)
    const privateApp = new OpenAPIHono({
        defaultHook: zodErrorHook,
    });
    privateApp.use(validateJsonBody);
    privateApp.use(maintenanceMiddleware);
    privateApp.use(authMiddleware);

    userRoutes(privateApp);
    wingoRoutes(privateApp);
    motoRoutes(privateApp);
    k3Routes(privateApp);
    fiveDRoutes(privateApp);
    trxwingoRoutes(privateApp);
    giftRoutes(privateApp);
    // Inout launch still requires login
    inoutPrivateRoutes(privateApp);
    // commissionRoutes(privateApp);
    // vipRoutes(privateApp);

    // const paymentApp = new OpenAPIHono();
    // bankRoutes(paymentApp);
    // privateApp.route("/payment", paymentApp);
    paymentRoutes(privateApp);

    // admin routes
    // const adminApp = new OpenAPIHono();
    adminRoutes(privateApp);
    // privateApp.route("/admin", adminApp);

    app.route("/api/v1", privateApp);

    app.doc("/doc", {
        openapi: "3.0.0",
        info: {
            version: "v1",
            title: "bcwin Web API",
        },
        tags: [
            {
                name: "auth",
                description: "Authentication routes",
            },
            {
                name: "user",
                description: "User related routes",
            },
            {
                name: "payment",
                description: "Payment and bank related routes",
            },
            {
                name: "admin",
                description: "Admin routes",
            },
            {
                name: "wingo",
                description: "Wingo betting game routes",
            },
            {
                name: "moto",
                description: "Moto Racing betting game routes",
            },
            {
                name: "k3",
                description: "K3 dice betting game routes",
            },
            {
                name: "5d",
                description: "5D betting game routes",
            },
            {
                name: "trxwingo",
                description: "TRXWingo betting game routes",
            },
            {
                name: "gift",
                description: "Gift routes",
            },
            {
                name: "callback",
                description:
                    "Callback routes. These routes should not be called directly by the client/browser.",
            },
            {
                name: "inout",
                description: "Inout betting game routes",
            },
        ],
    });

    app.get("/studio", Scalar({ url: "/doc" }));
};
