import { OpenAPIHono } from "@hono/zod-openapi";
import { websocket } from "hono/bun";
import { cors } from "hono/cors";
// BCWin Web API server
import { serve } from "bun";

import { WebSocketManager } from "@bcwin/websocket";
import { registerRoutes } from "./registerRoutes";
import { zodErrorHook } from "./lib/utils";
import * as Config from "@bcwin/config";
import { Cache } from "@bcwin/cache";
import Logger from "@bcwin/logger";
import { prisma, startPersistentDbPool, stopPersistentDbPool } from "@bcwin/db";
import { User } from "./types";

declare module "hono" {
    interface ContextVariableMap {
        user: User;
    }
}

const g = globalThis as unknown as {
    isShutdownHandlerRegistered?: boolean;
};

const mainLogger = new Logger("main");

try {
    await prisma.$connect();
    await startPersistentDbPool();
    mainLogger.info("Connected to the database.");
} catch (error) {
    mainLogger.error("Failed to connect to the database.", error);
    process.exit(1);
}

try {
    await Cache.ping();
    mainLogger.info("Connected to the Redis.");
} catch (error) {
    mainLogger.error("Failed to connect to the Redis.", error);
    process.exit(1);
}

WebSocketManager.initialize();

const app = new OpenAPIHono({
    defaultHook: zodErrorHook,
});

app.use(
    cors({
        origin: (origin) => {
            // CORS_ORIGINS=https://bcwin.club,https://www.bcwin.club
            const fromEnv = (process.env.CORS_ORIGINS ?? "")
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
            const allowedOrigins = [
                "http://localhost:3002",
                "http://127.0.0.1:3002",
                "https://bcwin.club",
                "https://www.bcwin.club",
                "https://www.bcwin7.site",
                "https://bcwin7.site",
                "https://www.bcwin7.live",
                "https://bcwin7.live",
                "https://www.bcwin.click",
                "https://bcwin.click",
                "https://www.bcwin7.xyz",
                "https://bcwin7.xyz",
                "https://www.bcwin.best",
                "https://bcwin.best",
                ...fromEnv,
            ];
            return allowedOrigins.includes(origin ?? "") ? origin : "";
        },
        credentials: true,
        allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization"],
    })
);

await registerRoutes(app, mainLogger);

const server = serve({
    fetch: app.fetch,
    port: process.env.API_PORT || 3000,
    websocket,
});

mainLogger.info(
    `${process.env.NODE_ENV === "production" ? "Production" : "Development"
    } server is running on port ${process.env.API_PORT || 3000}`
);

let isShuttingDown = false;

const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    mainLogger.info("Shutting down...");

    server.stop();

    try {
        await Promise.all([
            Promise.resolve()
                .then(() => stopPersistentDbPool())
                .then(() => prisma.$disconnect())
                .then(() => mainLogger.info("Database disconnected.")),
            WebSocketManager.shutdown().then(async () => {
                mainLogger.info("WebSocketManager disconnected.");

                await Cache.disconnect().then(() =>
                    mainLogger.info("Redis disconnected.")
                );
            }),
        ]);
    } catch (err) {
        mainLogger.error("Error during resource disconnection:", err);
    }

    mainLogger.info("Done");
    process.exit(0);
};

if (!g.isShutdownHandlerRegistered) {
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

    g.isShutdownHandlerRegistered = true;
}
