import { Context, TypedResponse } from "hono";
import { HTTP_STATUS } from "./http";
import { z } from "@hono/zod-openapi";
import * as Config from "@bcwin/config";
import { Hook } from "@hono/zod-openapi";
import { prisma } from "@bcwin/db";

type HttpStatusCode = (typeof HTTP_STATUS)[keyof typeof HTTP_STATUS];

const apiErrorResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: false,
    }),
    error: z.string().openapi({
        description: "Error message",
        example: "Invalid credentials",
    }),
});

type ApiErrorData = z.infer<typeof apiErrorResponseSchema>;

export function apiError<T extends HttpStatusCode>(
    c: Context,
    error: string,
    status: T
): TypedResponse<ApiErrorData, T>;

export function apiError(c: Context, error: string, status: HttpStatusCode) {
    return c.json({ success: false, error }, status);
}

export function middlewareApiError(
    c: Context,
    error: string,
    status: HttpStatusCode
) {
    return c.json({ success: false, error }, status);
}

const generateApiErrorResponseSchema = (statusCode: HttpStatusCode) => {
    let example = "Invalid credentials";

    if (statusCode === HTTP_STATUS.UNAUTHORIZED) {
        example = "Unauthorized";
    } else if (statusCode === HTTP_STATUS.BAD_REQUEST) {
        example = "Bad Request";
    } else if (statusCode === HTTP_STATUS.NOT_FOUND) {
        example = "Not Found";
    } else if (statusCode === HTTP_STATUS.INTERNAL_SERVER_ERROR) {
        example = "Internal Server Error";
    } else if (statusCode === HTTP_STATUS.SERVICE_UNAVAILABLE) {
        example = "Service Unavailable";
    }

    return z.object({
        success: z.boolean().openapi({
            description: "Whether the request was successful",
            example: false,
        }),
        error: z.string().openapi({
            description: "Error message",
            example,
        }),
    });
};

const createErrorResponse = (
    description: string,
    statusCode: HttpStatusCode
) => ({
    content: {
        "application/json": {
            schema: generateApiErrorResponseSchema(statusCode),
        },
    },
    description,
});

export const CommonResponses = {
    badRequest: (description = "Bad Request") => ({
        400: createErrorResponse(description, HTTP_STATUS.BAD_REQUEST),
    }),
    unauthorized: (description = "Unauthorized") => ({
        401: createErrorResponse(description, HTTP_STATUS.UNAUTHORIZED),
    }),
    notFound: (description = "Not Found") => ({
        404: createErrorResponse(description, HTTP_STATUS.NOT_FOUND),
    }),
    internalServerError: (description = "Internal Server Error") => ({
        500: createErrorResponse(
            description,
            HTTP_STATUS.INTERNAL_SERVER_ERROR
        ),
    }),
    serviceUnavailable: (description = "Service Unavailable") => ({
        503: createErrorResponse(description, HTTP_STATUS.SERVICE_UNAVAILABLE),
    }),
};

export async function calculateContractAmount(
    betAmount: number
): Promise<number> {
    return (
        (betAmount *
            (100 - (await Config.SystemSettings.getServiceFeePercent()))) /
        100
    );
}

export const zodErrorHook: Hook<any, any, any, any> = (result, c) => {
    if (!result.success) {
        // Determine status code based on validation location
        // 400 for query/param/header errors, 422 for body validation
        const target = (result as any).target || "json";
        const statusCode = target === "json" ? 422 : 400;

        return c.json(
            {
                success: false,
                error: result.error.issues
                    .map((issue: any) => {
                        const field = issue.path.join(".");
                        return `${field}: ${issue.message}`;
                    })
                    .join("; "),
            },
            statusCode
        );
    }
};

export const getTotalUserBets = async (
    userId: string,
    options?: { since?: Date; excludeInout?: boolean }
) => {
    const whereClause: any = { userId };
    if (options?.since) {
        whereClause.createdAt = { gte: options.since };
    }

    const promises: Promise<any>[] = [
        prisma.wingoBet.aggregate({
            where: whereClause,
            _sum: { betAmount: true },
        }),
        prisma.fiveDBet.aggregate({
            where: whereClause,
            _sum: { betAmount: true },
        }),
        prisma.k3Bet.aggregate({
            where: whereClause,
            _sum: { betAmount: true },
        }),
        prisma.motoBet.aggregate({
            where: whereClause,
            _sum: { betAmount: true },
        }),
        prisma.trxWingoBet.aggregate({
            where: whereClause,
            _sum: { betAmount: true },
        }),
    ];

    if (!options?.excludeInout) {
        promises.push(
            prisma.inoutBet.aggregate({
                where: whereClause,
                _sum: { betAmount: true },
            })
        );
    }

    const results = await Promise.all(promises);

    const wingo = results[0]?._sum?.betAmount || 0;
    const fiveD = results[1]?._sum?.betAmount || 0;
    const k3 = results[2]?._sum?.betAmount || 0;
    const moto = results[3]?._sum?.betAmount || 0;
    const trx = results[4]?._sum?.betAmount || 0;
    const inout = !options?.excludeInout ? (results[5]?._sum?.betAmount || 0) : 0;

    return wingo + fiveD + k3 + moto + trx + inout;
};

export const getTotalUserSlotBets = async (userId: string) => {
    const [wingoBets, fiveDBets, k3Bets, motoBets, trxWingoBets, inoutBets] =
        await Promise.all([
            prisma.wingoBet.aggregate({
                where: { userId },
                _sum: { betAmount: true },
            }),
            prisma.fiveDBet.aggregate({
                where: { userId },
                _sum: { betAmount: true },
            }),
            prisma.k3Bet.aggregate({
                where: { userId },
                _sum: { betAmount: true },
            }),
            prisma.motoBet.aggregate({
                where: { userId },
                _sum: { betAmount: true },
            }),
            prisma.trxWingoBet.aggregate({
                where: { userId },
                _sum: { betAmount: true },
            }),
            prisma.inoutBet.aggregate({
                where: { userId },
                _sum: { betAmount: true },
            }),
        ]);

    const total =
        (wingoBets._sum.betAmount || 0) +
        (fiveDBets._sum.betAmount || 0) +
        (k3Bets._sum.betAmount || 0) +
        (motoBets._sum.betAmount || 0) +
        (trxWingoBets._sum.betAmount || 0) +
        (inoutBets._sum.betAmount || 0);

    return total;
};

export const getClientIp = (c: Context) => {
    // Check x-forwarded-for (can contain multiple IPs, take the first/leftmost)
    const forwardedFor = c.req.header("x-forwarded-for");
    if (forwardedFor) {
        return forwardedFor.split(",")[0].trim();
    }

    // Cloudflare specific
    const cfConnectingIp = c.req.header("cf-connecting-ip");
    if (cfConnectingIp) return cfConnectingIp;

    // Nginx
    const realIp = c.req.header("x-real-ip");
    if (realIp) return realIp;

    // Fallback
    return c.req.header("x-forwarded");
};

export async function generateNextSerialNumber(tx?: any): Promise<number> {
    const dbClient = tx || prisma;
    const lastUser = await dbClient.user.findFirst({
        orderBy: { serialNumber: "desc" },
        select: { serialNumber: true },
    });

    const lastSerial = lastUser?.serialNumber || 0;
    const randomIncrement = Math.floor(Math.random() * (999 - 300 + 1)) + 300;
    return lastSerial + randomIncrement;
}

/**
 * Seconds before period end when betting must be rejected.
 * 30s periods → 5s · all longer → 10s (matches FE betLockSeconds).
 */
export function betLockSeconds(durationSeconds: number): number {
    return durationSeconds <= 30 ? 5 : 10;
}

/** True if now is inside the lock window, after end, or before start (pre-created next). */
export function isPeriodBettingLocked(
    period: {
        endTime: Date;
        durationSeconds: number;
        startTime?: Date;
    },
    now: Date = new Date()
): boolean {
    if (period.startTime && now.getTime() < period.startTime.getTime()) {
        return true;
    }
    const lockMs = betLockSeconds(period.durationSeconds) * 1000;
    return now.getTime() >= period.endTime.getTime() - lockMs;
}

/** Thrown when concurrent/atomic debit cannot cover betAmount. */
export class InsufficientBalanceError extends Error {
    constructor(message = "Insufficient balance") {
        super(message);
        this.name = "InsufficientBalanceError";
    }
}

type TxUserDebit = {
    user: {
        updateMany: (args: {
            where: { id: string; balance: { gte: number } };
            data: {
                balance: { decrement: number };
                xp: { increment: number };
            };
        }) => Promise<{ count: number }>;
        findUniqueOrThrow: (args: {
            where: { id: string };
            select: { balance: true };
        }) => Promise<{ balance: number }>;
    };
};

/**
 * Atomically debit `betAmount` only if current balance >= betAmount.
 * Prevents concurrent place-bet overdraft (auth-cache TOCTOU).
 * Call inside prisma.$transaction.
 */
export async function debitUserBalanceForBet(
    tx: TxUserDebit,
    userId: string,
    betAmount: number
): Promise<{ balance: number }> {
    const updated = await tx.user.updateMany({
        where: { id: userId, balance: { gte: betAmount } },
        data: {
            balance: { decrement: betAmount },
            xp: { increment: betAmount },
        },
    });
    if (updated.count === 0) {
        throw new InsufficientBalanceError();
    }
    return tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { balance: true },
    });
}
