import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { prisma, Prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import { REAL_USER_WHERE } from "@/lib/realUserFilter";

const logger = new Logger("admin-turnover");

// ─── Helper ──────────────────────────────────────────────────────────────────

function generateOrderId(): string {
    const d = new Date();
    const date =
        d.getUTCFullYear().toString() +
        String(d.getUTCMonth() + 1).padStart(2, "0") +
        String(d.getUTCDate()).padStart(2, "0");
    const rand = Math.floor(10000000000000 + Math.random() * 90000000000000);
    return `${date}-${rand}`;
}

async function getUserTotalBets(userId: string): Promise<number> {
    const whereClause = { userId };
    const [wingo, fiveD, k3, moto, trx, inout] = await Promise.all([
        prisma.wingoBet.aggregate({ where: whereClause, _sum: { betAmount: true } }),
        prisma.fiveDBet.aggregate({ where: whereClause, _sum: { betAmount: true } }),
        prisma.k3Bet.aggregate({ where: whereClause, _sum: { betAmount: true } }),
        prisma.motoBet.aggregate({ where: whereClause, _sum: { betAmount: true } }),
        prisma.trxWingoBet.aggregate({ where: whereClause, _sum: { betAmount: true } }),
        prisma.inoutBet.aggregate({ where: whereClause, _sum: { betAmount: true } }),
    ]);
    return (
        (wingo._sum.betAmount || 0) +
        (fiveD._sum.betAmount || 0) +
        (k3._sum.betAmount || 0) +
        (moto._sum.betAmount || 0) +
        (trx._sum.betAmount || 0) +
        (inout._sum.betAmount || 0)
    );
}

async function getUserTotalDeposits(userId: string): Promise<number> {
    const result = await prisma.deposit.aggregate({
        where: { userId, status: "SUCCESS" },
        _sum: { amount: true },
    });
    return result._sum.amount || 0;
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const turnoverUserSchema = z.object({
    serialNumber: z.number().int(),
    userId: z.string().uuid(),
    username: z.string(),
    totalBets: z.number(),
    totalDeposits: z.number(),
    totalTurnover: z.number(),
});

const getTurnoverQuerySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    username: z.string().optional(),
    userId: z.coerce.number().int().optional().openapi({
        description: "Serial number of the user",
    }),
    minTurnover: z.coerce.number().optional(),
    maxTurnover: z.coerce.number().optional(),
    minBets: z.coerce.number().optional(),
    maxBets: z.coerce.number().optional(),
    minDeposits: z.coerce.number().optional(),
    maxDeposits: z.coerce.number().optional(),
});

const getTurnoverResponseSchema = z.object({
    success: z.boolean(),
    data: z.array(turnoverUserSchema),
    total: z.number(),
    currentPage: z.number(),
    totalPages: z.number(),
});

const updateTurnoverBodySchema = z.object({
    amount: z
        .number()
        .openapi({
            description:
                "Amount to adjust turnover by. Positive = increase, negative = decrease.",
            example: 500,
        }),
    reason: z.string().optional().openapi({ description: "Optional admin note" }),
});

const updateTurnoverResponseSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    newTurnover: z.number(),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

export const turnoverRoutes = (app: OpenAPIHono) => {
    // GET /admin/turnover — list users with bets/deposits stats + filters
    app.openapi(
        createRoute({
            method: "get",
            path: "/",
            tags: ["admin"],
            summary: "List users turnover with filters",
            description:
                "Returns paginated list of users with total bets, total deposits (turnover). " +
                "Supports filtering by username, serial number, min/max turnover, min/max bets, min/max deposits.",
            request: {
                cookies: authCookie,
                query: getTurnoverQuerySchema,
            },
            responses: {
                200: {
                    description: "Turnover list fetched",
                    content: { "application/json": { schema: getTurnoverResponseSchema } },
                },
                ...CommonResponses.unauthorized(),
                ...CommonResponses.internalServerError(),
            },
        }),
        async (c) => {
            try {
                const {
                    page, limit, username, userId: serialNumber,
                    minTurnover, maxTurnover, minBets, maxBets,
                    minDeposits, maxDeposits,
                } = c.req.valid("query");

                const skip = (page - 1) * limit;

                // Build user filter
                const userWhere: any = {
                    ...REAL_USER_WHERE,
                };
                if (username) {
                    userWhere.username = { contains: username, mode: "insensitive" };
                }
                if (serialNumber !== undefined) {
                    userWhere.serialNumber = serialNumber;
                }

                // Fetch users (we'll filter by bet/deposit ranges in JS after aggregation)
                const [users, total] = await Promise.all([
                    prisma.user.findMany({
                        where: userWhere,
                        select: {
                            id: true,
                            serialNumber: true,
                            username: true,
                        },
                        orderBy: { serialNumber: "asc" },
                    }),
                    prisma.user.count({ where: userWhere }),
                ]);

                // Compute stats for all matching users in parallel
                const withStats = await Promise.all(
                    users.map(async (u) => {
                        const [totalBets, totalDeposits] = await Promise.all([
                            getUserTotalBets(u.id),
                            getUserTotalDeposits(u.id),
                        ]);
                        return {
                            serialNumber: u.serialNumber,
                            userId: u.id,
                            username: u.username,
                            totalBets,
                            totalDeposits,
                            totalTurnover: totalDeposits, // turnover = deposits
                        };
                    })
                );

                // Apply range filters in JS (since aggregations can't be done in WHERE easily)
                let filtered = withStats;
                if (minTurnover !== undefined) filtered = filtered.filter((u) => u.totalTurnover >= minTurnover);
                if (maxTurnover !== undefined) filtered = filtered.filter((u) => u.totalTurnover <= maxTurnover);
                if (minBets !== undefined) filtered = filtered.filter((u) => u.totalBets >= minBets);
                if (maxBets !== undefined) filtered = filtered.filter((u) => u.totalBets <= maxBets);
                if (minDeposits !== undefined) filtered = filtered.filter((u) => u.totalDeposits >= minDeposits);
                if (maxDeposits !== undefined) filtered = filtered.filter((u) => u.totalDeposits <= maxDeposits);

                // Paginate filtered results
                const totalFiltered = filtered.length;
                const paginated = filtered.slice(skip, skip + limit);

                return c.json(
                    {
                        success: true,
                        data: paginated,
                        total: totalFiltered,
                        currentPage: page,
                        totalPages: Math.ceil(totalFiltered / limit),
                    },
                    HTTP_STATUS.OK
                );
            } catch (error) {
                logger.error("Error fetching turnover list:", error);
                return apiError(c, "Failed to fetch turnover list", HTTP_STATUS.INTERNAL_SERVER_ERROR);
            }
        }
    );

    // PATCH /admin/turnover/:identifier — manually adjust user's turnover
    // :identifier can be any of: userId (UUID), serialNumber (integer), mobileNumber
    app.openapi(
        createRoute({
            method: "patch",
            path: "/:identifier",
            tags: ["admin"],
            summary: "Manually adjust user turnover",
            description:
                "Increase or decrease a user's turnover. " +
                "`:identifier` accepts any of the three unique user keys: " +
                "`userId` (UUID), `serialNumber` (integer), or `mobileNumber`. " +
                "Positive amount = creates a synthetic deposit (method: ADMIN_MANUAL). " +
                "Negative amount = removes turnover (creates a synthetic withdraw record). " +
                "**Balance is NOT changed** — only turnover is affected.",
            request: {
                cookies: authCookie,
                params: z.object({
                    identifier: z.string().openapi({
                        description: "User UUID, serial number, or mobile number",
                        example: "10006",
                    }),
                }),
                body: {
                    content: { "application/json": { schema: updateTurnoverBodySchema } },
                },
            },
            responses: {
                200: {
                    description: "Turnover updated successfully",
                    content: { "application/json": { schema: updateTurnoverResponseSchema } },
                },
                404: { description: "User not found" },
                ...CommonResponses.unauthorized(),
                ...CommonResponses.internalServerError(),
            },
        }),
        async (c) => {
            try {
                const { identifier } = c.req.valid("param");
                const { amount, reason } = c.req.valid("json");
                const admin = c.get("user");

                if (amount === 0) {
                    return apiError(c, "Amount must be non-zero", HTTP_STATUS.BAD_REQUEST as any);
                }

                // Auto-detect which unique key was provided:
                // 1. UUID format → userId
                // 2. All-digit string → serialNumber
                // 3. Anything else → mobileNumber
                const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                const DIGITS_ONLY = /^\d+$/;

                let whereClause: Prisma.UserWhereUniqueInput;
                if (UUID_REGEX.test(identifier)) {
                    whereClause = { id: identifier };
                } else if (DIGITS_ONLY.test(identifier)) {
                    whereClause = { serialNumber: parseInt(identifier, 10) };
                } else {
                    whereClause = { mobileNumber: identifier };
                }

                const user = await prisma.user.findUnique({
                    where: whereClause,
                    select: { id: true, username: true, isDemo: true },
                });

                if (!user) {
                    return apiError(c, "User not found", HTTP_STATUS.NOT_FOUND as any);
                }

                if (user.isDemo) {
                    return apiError(c, "Cannot adjust turnover for demo users", HTTP_STATUS.BAD_REQUEST as any);
                }

                // Use resolved UUID for all DB ops below
                const userId = user.id;


                const absAmount = Math.trunc(Math.abs(amount)); // Deposit/Withdraw.amount is Int in schema
                const orderId = generateOrderId();
                const adminNote = reason || `Manual turnover ${amount > 0 ? "increase" : "decrease"} by admin`;

                await prisma.$transaction(async (tx) => {
                    if (amount > 0) {
                        // Increase: synthetic deposit
                        await tx.deposit.create({
                            data: {
                                userId,
                                amount: absAmount,
                                method: "ADMIN_MANUAL",
                                status: "SUCCESS",
                                orderId,
                            },
                        });
                    } else {
                        // Decrease: synthetic withdraw (does NOT touch balance)
                        await tx.withdraw.create({
                            data: {
                                userId,
                                amount: absAmount,
                                method: "ADMIN_MANUAL",
                                status: "SUCCESS",
                                orderId,
                                note: adminNote,
                            },
                        });
                    }

                    // Audit log using existing AdminBalanceUpdateTransaction
                    // amount=0 to signal this is purely a turnover adjustment (no balance change)
                    await tx.adminBalanceUpdateTransaction.create({
                        data: {
                            userId,
                            byUserId: admin.id,
                            amount: 0, // balance NOT changed
                            reason: `[TURNOVER ${amount > 0 ? "+" : ""}${amount}] ${adminNote}`,
                        },
                    });
                });

                const newTurnover = await getUserTotalDeposits(userId);

                logger.info(
                    `Turnover ${amount > 0 ? "increased" : "decreased"} for user ${userId} ` +
                    `by ${absAmount}. Admin: ${admin.id}. Reason: ${adminNote}`
                );

                return c.json(
                    {
                        success: true,
                        message: `Turnover ${amount > 0 ? "increased" : "decreased"} by ${absAmount} successfully`,
                        newTurnover,
                    },
                    HTTP_STATUS.OK
                );
            } catch (error) {
                logger.error("Error updating turnover:", error);
                return apiError(c, "Failed to update turnover", HTTP_STATUS.INTERNAL_SERVER_ERROR);
            }
        }
    );
};
