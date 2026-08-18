import { HTTP_STATUS } from "./http";

const TRANSIENT_CODES = new Set([
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "EPIPE",
    "ENOTFOUND",
    "EAI_AGAIN",
    "P1001",
    "P1002",
    "P1008",
    "P1017",
    "P2024",
]);

const TRANSIENT_SNIPPETS = [
    "connection terminated",
    "can't reach database server",
    "server closed the connection",
    "connection reset",
    "too many connections",
    "remaining connection slots",
    "the database system is starting up",
    "the database system is shutting down",
    "connect econnrefused",
    "connect etimedout",
    "timeout exceeded when trying to connect",
    "timed out fetching a new connection",
];

/** True for dropped/idle Neon sockets, connect timeouts, and Prisma pool errors. */
export function isTransientDbError(error: unknown): boolean {
    const seen = new Set<unknown>();

    const walk = (err: unknown): boolean => {
        if (err == null || seen.has(err)) return false;
        seen.add(err);

        if (typeof err === "string") {
            const s = err.toLowerCase();
            return TRANSIENT_SNIPPETS.some((p) => s.includes(p));
        }
        if (typeof err !== "object") return false;

        const o = err as {
            code?: unknown;
            message?: unknown;
            name?: unknown;
            cause?: unknown;
        };
        if (typeof o.code === "string" && TRANSIENT_CODES.has(o.code)) {
            return true;
        }
        if (typeof o.name === "string" && o.name === "PrismaClientInitializationError") {
            return true;
        }
        if (typeof o.message === "string") {
            const s = o.message.toLowerCase();
            if (TRANSIENT_SNIPPETS.some((p) => s.includes(p))) return true;
        }
        return walk(o.cause);
    };

    return walk(error);
}

export function authCatchResponse(error: unknown): {
    message: string;
    status:
        | typeof HTTP_STATUS.UNAUTHORIZED
        | typeof HTTP_STATUS.SERVICE_UNAVAILABLE;
} {
    if (isTransientDbError(error)) {
        return {
            message: "Service temporarily unavailable",
            status: HTTP_STATUS.SERVICE_UNAVAILABLE,
        };
    }
    return {
        message: "Authentication failed",
        status: HTTP_STATUS.UNAUTHORIZED,
    };
}
