import { OpenAPIHono } from "@hono/zod-openapi";
import { upgradeWebSocket } from "hono/bun";
import { User } from "@bcwin/db";

import Logger from "@bcwin/logger";
import { WebSocketManager } from "@bcwin/websocket";
import { websocketMiddleware } from "@/middleware";

const logger = new Logger("websocket");

export const websocketRoutes = (app: OpenAPIHono) => {
    app.get(
        "/ws",
        websocketMiddleware,
        upgradeWebSocket((c) => {
            const id = c.get("validatedId");
            const user = c.get("user") as User | undefined;

            logger.debug(`WebSocket connection upgrade requested`, {
                connectionId: id,
                userId: user?.id ?? "guest",
            });

            return {
                onOpen: (event, ws) => {
                    WebSocketManager.addClient(id, ws, user);
                },
                onMessage(event, ws) {
                    if (event.data.toString() === "ping") {
                        ws.send("pong");
                        return;
                    }

                    WebSocketManager.handleIncomingMessage(
                        id,
                        event.data.toString()
                    );
                },
                onClose: () => {
                    if (!WebSocketManager.isShuttingDown()) {
                        WebSocketManager.removeClient(id);
                    }
                },
                onError: (err) => {
                    logger.warn(`WebSocket error for id ${id}:`, err);
                    if (!WebSocketManager.isShuttingDown()) {
                        WebSocketManager.removeClient(id);
                    }
                },
            };
        })
    );
};
