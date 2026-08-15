import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    min: 2,
    max: 5,
});
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

export * from "./generated/prisma/client";