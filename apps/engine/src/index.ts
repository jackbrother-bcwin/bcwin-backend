import { serve } from "bun";
import { Hono } from "hono";

import Logger from "@bcwin/logger";
import { Cache } from "@bcwin/cache";
import { prisma, startPersistentDbPool, stopPersistentDbPool } from "@bcwin/db";
import { WebSocketManager } from "@bcwin/websocket";

import { WingoScheduler } from "./scheduler/wingoScheduler";
import { MotoScheduler } from "./scheduler/motoScheduler";
import { K3Scheduler } from "./scheduler/k3Scheduler";
import { FiveDScheduler } from "./scheduler/5dScheduler";
import { TrxWingoScheduler } from "./scheduler/trxWingoScheduler";
import { CommissionScheduler } from "./scheduler/commissionScheduler";
import { VipLevelScheduler } from "./scheduler/vipLevelScheduler";
import { RebateScheduler } from "./scheduler/rebateScheduler";
import { SelfRebateScheduler } from "./scheduler/selfRebateScheduler";
import { ActivityBonusScheduler } from "./scheduler/activityBonusScheduler";
import { IpRiskLevelScheduler } from "./scheduler/ipRiskLevelScheduler";
import { SalaryScheduler } from "./scheduler/salaryScheduler";
import { DepositTimeoutScheduler } from "./scheduler/depositTimeoutScheduler";

const g = globalThis as unknown as {
    isShutdownHandlerRegistered?: boolean;
};

const logger = new Logger("engine");

try {
    await prisma.$connect();
    await startPersistentDbPool();
} catch (error) {
    logger.error("Failed to connect to the database.", error);
    process.exit(1);
}

try {
    await Cache.ping();
} catch (error) {
    logger.error("Failed to connect to the Redis.", error);
    process.exit(1);
}

WebSocketManager.initialize();

const wingoScheduler = new WingoScheduler();
const motoScheduler = new MotoScheduler();
const k3Scheduler = new K3Scheduler();
const fiveDScheduler = new FiveDScheduler();
const trxWingoScheduler = new TrxWingoScheduler();
const commissionScheduler = new CommissionScheduler();
const vipLevelScheduler = new VipLevelScheduler();
const rebateScheduler = new RebateScheduler();
const selfRebateScheduler = new SelfRebateScheduler();
const activityBonusScheduler = new ActivityBonusScheduler();
const ipRiskLevelScheduler = new IpRiskLevelScheduler();
const salaryScheduler = new SalaryScheduler();
const depositTimeoutScheduler = new DepositTimeoutScheduler();

const app = new Hono();

wingoScheduler.start();
motoScheduler.start();
k3Scheduler.start();
fiveDScheduler.start();
trxWingoScheduler.start();
commissionScheduler.start();
vipLevelScheduler.start();
rebateScheduler.start();
selfRebateScheduler.start();
activityBonusScheduler.start();
ipRiskLevelScheduler.start();
salaryScheduler.start();
depositTimeoutScheduler.start();

const server = serve({
    fetch: app.fetch,
    port: process.env.ENGINE_PORT || 3001,
});

logger.info(
    `${process.env.NODE_ENV === "production" ? "Production" : "Development"
    } game engine is running on port ${process.env.ENGINE_PORT || 3001}`
);

let isShuttingDown = false;

const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info("Shutting down...");

    server.stop();

    try {
        await Promise.all([
            Promise.resolve()
                .then(() => stopPersistentDbPool())
                .then(() => prisma.$disconnect())
                .then(() => logger.info("Prisma disconnected.")),
            WebSocketManager.shutdown().then(async () => {
                logger.info("WebSocketManager disconnected.");

                await Cache.disconnect().then(() =>
                    logger.info("Redis disconnected.")
                );
            }),
            wingoScheduler.stop(),
            motoScheduler.stop(),
            k3Scheduler.stop(),
            fiveDScheduler.stop(),
            trxWingoScheduler.stop(),
            commissionScheduler.stop(),
            vipLevelScheduler.stop(),
            rebateScheduler.stop(),
            selfRebateScheduler.stop(),
            activityBonusScheduler.stop(),
            ipRiskLevelScheduler.stop(),
            salaryScheduler.stop(),
            depositTimeoutScheduler.stop(),
        ]);
    } catch (err) {
        logger.error("Error during resource disconnection:", err);
    }

    logger.info("Done");
    process.exit(0);
};

if (!g.isShutdownHandlerRegistered) {
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

    g.isShutdownHandlerRegistered = true;
}
