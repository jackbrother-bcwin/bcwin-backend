import { PrismaPg } from "@prisma/adapter-pg";
import Logger from "@bcwin/logger";
import { PrismaClient } from "./generated/prisma/client";

const logger = new Logger("db-pool");

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

/** Direct Neon / Postgres process pool. Never idle-close; keepalive + heartbeat keep sockets up. */
export const PG_POOL_OPTIONS = {
    min: 2,
    max: 5,
    idleTimeoutMillis: 0,
    connectionTimeoutMillis: 5_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
} as const;

export const DB_HEARTBEAT_MS = 30_000;

const adapter = new PrismaPg(
    {
        connectionString: process.env.DATABASE_URL,
        ...PG_POOL_OPTIONS,
    },
    {
        onPoolError: (err) => {
            logger.warn("Idle database connection dropped", err.message);
        },
    }
);
const isProduction = process.env.NODE_ENV === "production";

/**
 * After `prisma generate` adds models, a long-lived hot-reload process may still
 * hold a PrismaClient instance built from the previous client. Detect and recreate.
 */
function createClient() {
    return new PrismaClient({
        adapter,
        // log: isProduction ? ["error"] : ["query", "error"],
    });
}

function isStaleClient(client: PrismaClient | undefined): boolean {
    if (!client) return false;
    // Any newly generated delegate used by this app — extend if needed
    const c = client as unknown as {
        selfRebate?: unknown;
        selfRebateRateConfig?: unknown;
    };
    return (
        typeof c.selfRebate === "undefined" ||
        typeof c.selfRebateRateConfig === "undefined"
    );
}

if (!isProduction && isStaleClient(globalForPrisma.prisma)) {
    void globalForPrisma.prisma?.$disconnect().catch(() => undefined);
    globalForPrisma.prisma = undefined;
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (!isProduction) {
    globalForPrisma.prisma = prisma;
}

let heartbeat: ReturnType<typeof setInterval> | null = null;

/** Open the reserved sockets and ping every 30s so Neon/NAT cannot drop them. */
export async function startPersistentDbPool(): Promise<void> {
    await Promise.all(
        Array.from({ length: PG_POOL_OPTIONS.min }, () =>
            prisma.$queryRaw`SELECT 1`
        )
    );
    if (heartbeat) return;
    heartbeat = setInterval(() => {
        void prisma.$queryRaw`SELECT 1`.catch((err) => {
            logger.warn(
                "Database heartbeat failed",
                err instanceof Error ? err.message : err
            );
        });
    }, DB_HEARTBEAT_MS);
    heartbeat.unref?.();
}

export function stopPersistentDbPool(): void {
    if (!heartbeat) return;
    clearInterval(heartbeat);
    heartbeat = null;
}

export * from "./generated/prisma/client";