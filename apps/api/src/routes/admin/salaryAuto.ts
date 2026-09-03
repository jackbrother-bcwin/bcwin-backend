import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie, limit, page } from "@/schemas";
import { prisma } from "@bcwin/db";
import {
    AUTO_SALARY_SLABS,
    approveAutoSalaryClaim,
    generateAutoSalaries,
    getIstDayRange,
    rejectAutoSalaryClaim,
} from "@/lib/autoSalaryService";
import { rejectIfAutoSalaryPaused } from "@/lib/autoSalaryGate";
import { adminUserSearchOr, normalizeAdminUserSearch } from "@/lib/adminUserSearch";

const logger = new Logger("admin-auto-salary");

// ===================== Schemas =====================

const AutoClaimSchema = z.object({
    id: z.string(),
    userId: z.string(),
    periodDate: z.string(),
    amount: z.number(),
    slabIndex: z.number(),
    directCount: z.number(),
    activeCount: z.number(),
    teamDeposit: z.number(),
    status: z.enum(["PENDING", "APPROVED", "REJECTED"]),
    rejectReason: z.string().nullable().optional(),
    reviewedAt: z.string().nullable().optional(),
    createdAt: z.string(),
    user: z
        .object({
            serialNumber: z.number(),
            username: z.string(),
            mobileNumber: z.string(),
        })
        .optional(),
});

function formatClaim(c: {
    id: string;
    userId: string;
    periodDate: Date;
    amount: number;
    slabIndex: number;
    directCount: number;
    activeCount: number;
    teamDeposit: number;
    status: string;
    rejectReason: string | null;
    reviewedAt: Date | null;
    createdAt: Date;
    user?: {
        serialNumber: number;
        username: string;
        mobileNumber: string;
    } | null;
}) {
    return {
        id: c.id,
        userId: c.userId,
        periodDate: c.periodDate.toISOString(),
        amount: c.amount,
        slabIndex: c.slabIndex,
        directCount: c.directCount,
        activeCount: c.activeCount,
        teamDeposit: c.teamDeposit,
        status: c.status as "PENDING" | "APPROVED" | "REJECTED",
        rejectReason: c.rejectReason,
        reviewedAt: c.reviewedAt?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
        user: c.user
            ? {
                  serialNumber: c.user.serialNumber,
                  username: c.user.username,
                  mobileNumber: c.user.mobileNumber,
              }
            : undefined,
    };
}

// ===================== Route definitions =====================

const listSlabsRoute = createRoute({
    method: "get",
    path: "/auto/slabs",
    tags: ["admin"],
    summary: "List automatic salary slabs",
    description:
        "Highest fully-met slab is paid. Need that many active L1s (bet ≥ ₹150 / 24h) plus extra actives from L1–L6 (direct + listed active), and one-day team deposit. Demo accounts never count.",
    request: { cookies: authCookie },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        slabs: z.array(
                            z.object({
                                index: z.number(),
                                reward: z.number(),
                                direct: z.number(),
                                active: z.number(),
                                teamDeposit: z.number(),
                            })
                        ),
                    }),
                },
            },
            description: "Slabs listed",
        },
        ...CommonResponses.internalServerError(),
        ...CommonResponses.serviceUnavailable(),
    },
});

const generateRoute = createRoute({
    method: "post",
    path: "/auto/generate",
    tags: ["admin"],
    summary: "Generate automatic salary claims for a day",
    description:
        "Evaluate all non-demo users with downline for the given IST date. Creates/updates PENDING claims. Never overwrites APPROVED. Demo downline is excluded from all metrics.",
    request: {
        cookies: authCookie,
        body: {
            content: {
                "application/json": {
                    schema: z.object({
                        periodDate: z
                            .string()
                            .regex(/^\d{4}-\d{2}-\d{2}$/)
                            .openapi({
                                description: "IST calendar day YYYY-MM-DD",
                                example: "2026-07-19",
                            }),
                    }),
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        message: z.string(),
                        result: z.object({
                            periodDate: z.string(),
                            created: z.number(),
                            updated: z.number(),
                            skippedNoSlab: z.number(),
                            skippedApproved: z.number(),
                            evaluated: z.number(),
                        }),
                    }),
                },
            },
            description: "Generation finished",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
        ...CommonResponses.serviceUnavailable(),
    },
});

const listClaimsRoute = createRoute({
    method: "get",
    path: "/auto/claims",
    tags: ["admin"],
    summary: "List automatic salary claims",
    request: {
        cookies: authCookie,
        query: z.object({
            page,
            limit,
            status: z
                .enum(["PENDING", "APPROVED", "REJECTED"])
                .optional()
                .openapi({ description: "Filter by status" }),
            periodDate: z
                .string()
                .regex(/^\d{4}-\d{2}-\d{2}$/)
                .optional()
                .openapi({ description: "IST day YYYY-MM-DD" }),
            search: z.string().optional().openapi({
                description: "Mobile, username, UUID, or exact serial prefixed with #",
            }),
        }),
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        claims: z.array(AutoClaimSchema),
                        total: z.number(),
                        currentPage: z.number(),
                        totalPages: z.number(),
                    }),
                },
            },
            description: "Claims listed",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
        ...CommonResponses.serviceUnavailable(),
    },
});

const approveRoute = createRoute({
    method: "post",
    path: "/auto/claims/{id}/approve",
    tags: ["admin"],
    summary: "Approve claim and credit balance",
    request: {
        cookies: authCookie,
        params: z.object({
            id: z.string().openapi({ description: "Claim ID" }),
        }),
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        message: z.string(),
                        amount: z.number(),
                        balance: z.number(),
                    }),
                },
            },
            description: "Approved",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
        ...CommonResponses.serviceUnavailable(),
    },
});

const rejectRoute = createRoute({
    method: "post",
    path: "/auto/claims/{id}/reject",
    tags: ["admin"],
    summary: "Reject a pending claim",
    request: {
        cookies: authCookie,
        params: z.object({
            id: z.string().openapi({ description: "Claim ID" }),
        }),
        body: {
            content: {
                "application/json": {
                    schema: z
                        .object({
                            reason: z.string().optional(),
                        })
                        .optional(),
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        message: z.string(),
                    }),
                },
            },
            description: "Rejected",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
        ...CommonResponses.serviceUnavailable(),
    },
});

// ===================== Handlers =====================

export const autoSalaryRoutes = (app: OpenAPIHono) => {
    app.openapi(listSlabsRoute, async (c) => {
        const paused = rejectIfAutoSalaryPaused(c);
        if (paused) return paused;
        try {
            return c.json(
                {
                    success: true,
                    slabs: AUTO_SALARY_SLABS.map((s, index) => ({
                        index,
                        reward: s.reward,
                        direct: s.direct,
                        active: s.active,
                        teamDeposit: s.teamDeposit,
                    })),
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error(error);
            return apiError(
                c,
                "Internal server error",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.openapi(generateRoute, async (c) => {
        const paused = rejectIfAutoSalaryPaused(c);
        if (paused) return paused;
        try {
            const { periodDate } = c.req.valid("json");
            // Validate date early
            getIstDayRange(periodDate);

            const result = await generateAutoSalaries(periodDate);

            return c.json(
                {
                    success: true,
                    message: `Generated for ${periodDate}: ${result.created} created, ${result.updated} updated`,
                    result,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error(error);
            const msg =
                error instanceof Error
                    ? error.message
                    : "Internal server error";
            return apiError(
                c,
                msg,
                msg.includes("periodDate")
                    ? HTTP_STATUS.BAD_REQUEST
                    : HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.openapi(listClaimsRoute, async (c) => {
        const paused = rejectIfAutoSalaryPaused(c);
        if (paused) return paused;
        try {
            const { page, limit, status, periodDate, search } =
                c.req.valid("query");
            const pageNum = Number(page) || 1;
            const limitNum = Math.min(Math.max(Number(limit) || 30, 1), 200);
            const skip = (pageNum - 1) * limitNum;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const where: any = {};

            if (status) {
                where.status = status;
            }

            if (periodDate) {
                const { periodDate: pd } = getIstDayRange(periodDate);
                where.periodDate = pd;
            }

            const normalizedSearch = normalizeAdminUserSearch(search);
            if (normalizedSearch) {
                where.user = {
                    OR: adminUserSearchOr(normalizedSearch),
                };
            }

            const [claims, total] = await Promise.all([
                prisma.autoSalaryClaim.findMany({
                    where,
                    take: limitNum,
                    skip,
                    orderBy: [{ periodDate: "desc" }, { amount: "desc" }],
                    include: {
                        user: {
                            select: {
                                serialNumber: true,
                                username: true,
                                mobileNumber: true,
                            },
                        },
                    },
                }),
                prisma.autoSalaryClaim.count({ where }),
            ]);

            const totalPages = Math.max(1, Math.ceil(total / limitNum));

            return c.json(
                {
                    success: true,
                    claims: claims.map(formatClaim),
                    total,
                    currentPage: pageNum,
                    totalPages,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("list auto salary claims failed", error);
            const msg =
                error instanceof Error
                    ? error.message
                    : "Internal server error";
            return apiError(
                c,
                msg,
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.openapi(approveRoute, async (c) => {
        const paused = rejectIfAutoSalaryPaused(c);
        if (paused) return paused;
        try {
            const { id } = c.req.valid("param");
            const admin = c.get("user");

            const result = await approveAutoSalaryClaim(id, admin.id);

            return c.json(
                {
                    success: true,
                    message: "Salary approved and credited",
                    amount: result.amount,
                    balance: result.balance,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error(error);
            const msg =
                error instanceof Error
                    ? error.message
                    : "Internal server error";
            const isClient =
                msg.includes("not found") ||
                msg.includes("already") ||
                msg.includes("rejected") ||
                msg.includes("demo");
            return apiError(
                c,
                msg,
                isClient
                    ? HTTP_STATUS.BAD_REQUEST
                    : HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.openapi(rejectRoute, async (c) => {
        const paused = rejectIfAutoSalaryPaused(c);
        if (paused) return paused;
        try {
            const { id } = c.req.valid("param");
            const admin = c.get("user");
            const body = c.req.valid("json") as { reason?: string } | undefined;

            await rejectAutoSalaryClaim(id, admin.id, body?.reason);

            return c.json(
                {
                    success: true,
                    message: "Claim rejected",
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error(error);
            const msg =
                error instanceof Error
                    ? error.message
                    : "Internal server error";
            const isClient =
                msg.includes("not found") || msg.includes("Cannot reject");
            return apiError(
                c,
                msg,
                isClient
                    ? HTTP_STATUS.BAD_REQUEST
                    : HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
