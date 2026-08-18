import { describe, test, expect, beforeEach } from "bun:test";
import { HTTP_STATUS } from "../../apps/api/src/lib/http";
import {
    isTransientDbError,
    authCatchResponse,
} from "../../apps/api/src/lib/dbError";
import {
    isMaintenanceFailOpen,
    noteMaintenanceDbFailure,
    clearMaintenanceFailOpen,
    MAINTENANCE_FAIL_OPEN_TTL_SEC,
} from "../../apps/api/src/middleware/maintenance";
import {
    PG_POOL_OPTIONS,
    DB_HEARTBEAT_MS,
    startPersistentDbPool,
    stopPersistentDbPool,
    prisma,
} from "@bcwin/db";

describe("Neon / pool resilience", () => {
    test("process pool keeps two warm sockets and fails connect in 5s", () => {
        expect(PG_POOL_OPTIONS.min).toBe(2);
        expect(PG_POOL_OPTIONS.max).toBe(5);
        expect(PG_POOL_OPTIONS.keepAlive).toBe(true);
        expect(PG_POOL_OPTIONS.keepAliveInitialDelayMillis).toBe(10_000);
        expect(PG_POOL_OPTIONS.connectionTimeoutMillis).toBe(5_000);
        expect(PG_POOL_OPTIONS.idleTimeoutMillis).toBe(0);
    });

    test("isTransientDbError matches dropped Neon sockets and Prisma timeouts", () => {
        expect(
            isTransientDbError(
                new Error("Connection terminated unexpectedly")
            )
        ).toBe(true);
        expect(
            isTransientDbError({
                code: "ETIMEDOUT",
                meta: { modelName: "TrxWingoBet" },
                clientVersion: "7.9.1",
            })
        ).toBe(true);
        expect(
            isTransientDbError({
                name: "PrismaClientInitializationError",
                message: "Can't reach database server",
            })
        ).toBe(true);
        expect(
            isTransientDbError({
                code: "P1001",
                message: "Can't reach database server at ep-xxx",
            })
        ).toBe(true);
        expect(
            isTransientDbError({
                message: "wrapper",
                cause: new Error("Connection terminated unexpectedly"),
            })
        ).toBe(true);
        expect(isTransientDbError(new Error("Invalid token"))).toBe(false);
        expect(isTransientDbError(new Error("Authentication failed"))).toBe(
            false
        );
        expect(isTransientDbError(null)).toBe(false);
    });

    test("persistent pool warms reserved sockets and heartbeat can start/stop", async () => {
        expect(DB_HEARTBEAT_MS).toBe(30_000);
        await startPersistentDbPool();
        const rows = await prisma.$queryRaw<Array<{ "?column?": number }>>`SELECT 1`;
        expect(rows.length).toBe(1);
        stopPersistentDbPool();
        stopPersistentDbPool();
    });

    test("auth catch is 503 on DB drop and 401 on bad token", () => {
        const down = authCatchResponse(
            new Error("Connection terminated unexpectedly")
        );
        expect(down.status).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE);
        expect(down.message).toBe("Service temporarily unavailable");

        const bad = authCatchResponse(new Error("Invalid token"));
        expect(bad.status).toBe(HTTP_STATUS.UNAUTHORIZED);
        expect(bad.message).toBe("Authentication failed");
    });
});

describe("maintenance fail-open", () => {
    beforeEach(() => {
        clearMaintenanceFailOpen();
    });

    test("a DB miss is remembered for 10s so the next request skips Prisma", () => {
        expect(MAINTENANCE_FAIL_OPEN_TTL_SEC).toBe(10);
        expect(isMaintenanceFailOpen()).toBe(false);
        noteMaintenanceDbFailure();
        expect(isMaintenanceFailOpen()).toBe(true);
        clearMaintenanceFailOpen();
        expect(isMaintenanceFailOpen()).toBe(false);
    });

    test("fail-open expires after the TTL", () => {
        const started = Date.now();
        noteMaintenanceDbFailure(started);
        expect(isMaintenanceFailOpen(started + 9_000)).toBe(true);
        expect(isMaintenanceFailOpen(started + 10_000)).toBe(false);
    });
});
