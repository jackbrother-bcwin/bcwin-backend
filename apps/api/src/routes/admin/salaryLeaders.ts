import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import {
    adminUserSearchOr,
    normalizeAdminUserSearch,
} from "@/lib/adminUserSearch";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";

const logger = new Logger("admin-salary-leaders");

const SalaryLeaderUserSchema = z.object({
    id: z.string().uuid(),
    serialNumber: z.number(),
    username: z.string(),
    mobileNumber: z.string(),
    email: z.string().nullable(),
    role: z.enum(["USER", "ADMIN", "SUB_ADMIN", "AGENT"]),
    isDemo: z.boolean(),
});

const SalaryLeaderSchema = z.object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    createdAt: z.string(),
    user: SalaryLeaderUserSchema,
});

const ListSalaryLeadersQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    search: z.string().max(100).optional().openapi({
        description:
            "Search by mobile, username, email/referral code, UUID, or exact serial prefixed with #",
    }),
});

const ListSalaryLeadersResponseSchema = z.object({
    success: z.literal(true),
    leaders: z.array(SalaryLeaderSchema),
    total: z.number(),
    currentPage: z.number(),
    totalPages: z.number(),
});

const CreateSalaryLeaderBodySchema = z.object({
    userId: z.string().uuid(),
});

const SalaryLeaderMutationResponseSchema = z.object({
    success: z.literal(true),
    message: z.string(),
    leader: SalaryLeaderSchema.optional(),
});

const userSelect = {
    id: true,
    serialNumber: true,
    username: true,
    mobileNumber: true,
    email: true,
    role: true,
    isDemo: true,
} as const;

function formatLeader(leader: {
    id: string;
    userId: string;
    createdAt: Date;
    user: {
        id: string;
        serialNumber: number;
        username: string;
        mobileNumber: string;
        email: string | null;
        role: "USER" | "ADMIN" | "SUB_ADMIN" | "AGENT";
        isDemo: boolean;
    };
}) {
    return {
        ...leader,
        createdAt: leader.createdAt.toISOString(),
    };
}

export const salaryLeadersRoutes = (app: OpenAPIHono) => {
    app.openapi(
        createRoute({
            method: "get",
            path: "/",
            tags: ["Admin Salary Leaders"],
            summary: "List salary leaders",
            request: {
                cookies: authCookie,
                query: ListSalaryLeadersQuerySchema,
            },
            responses: {
                200: {
                    description: "Salary leaders retrieved successfully",
                    content: {
                        "application/json": {
                            schema: ListSalaryLeadersResponseSchema,
                        },
                    },
                },
                ...CommonResponses.internalServerError(),
            },
        }),
        async (c) => {
            try {
                const { page, limit, search } = c.req.valid("query");
                const normalizedSearch = normalizeAdminUserSearch(search);
                const where = normalizedSearch
                    ? {
                          user: {
                              is: {
                                  OR: adminUserSearchOr(normalizedSearch),
                              },
                          },
                      }
                    : {};

                const [leaders, total] = await Promise.all([
                    prisma.salaryLeader.findMany({
                        where,
                        skip: (page - 1) * limit,
                        take: limit,
                        orderBy: { createdAt: "desc" },
                        include: { user: { select: userSelect } },
                    }),
                    prisma.salaryLeader.count({ where }),
                ]);

                return c.json(
                    {
                        success: true as const,
                        leaders: leaders.map(formatLeader),
                        total,
                        currentPage: page,
                        totalPages: Math.max(1, Math.ceil(total / limit)),
                    },
                    HTTP_STATUS.OK
                );
            } catch (error) {
                logger.error(error);
                return apiError(
                    c,
                    "Failed to load salary leaders",
                    HTTP_STATUS.INTERNAL_SERVER_ERROR
                );
            }
        }
    );

    app.openapi(
        createRoute({
            method: "post",
            path: "/",
            tags: ["Admin Salary Leaders"],
            summary: "Add a user to salary leaders",
            request: {
                cookies: authCookie,
                body: {
                    content: {
                        "application/json": {
                            schema: CreateSalaryLeaderBodySchema,
                        },
                    },
                },
            },
            responses: {
                201: {
                    description: "User added to salary leaders",
                    content: {
                        "application/json": {
                            schema: SalaryLeaderMutationResponseSchema,
                        },
                    },
                },
                ...CommonResponses.badRequest(),
                ...CommonResponses.notFound(),
                ...CommonResponses.internalServerError(),
            },
        }),
        async (c) => {
            const { userId } = c.req.valid("json");

            try {
                const [user, existing] = await Promise.all([
                    prisma.user.findUnique({
                        where: { id: userId },
                        select: { id: true },
                    }),
                    prisma.salaryLeader.findUnique({ where: { userId } }),
                ]);

                if (!user) {
                    return apiError(c, "User not found", HTTP_STATUS.NOT_FOUND);
                }
                if (existing) {
                    return apiError(
                        c,
                        "User is already in Salary Leaders",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }

                const leader = await prisma.salaryLeader.create({
                    data: { userId },
                    include: { user: { select: userSelect } },
                });

                return c.json(
                    {
                        success: true as const,
                        message: "User added to Salary Leaders",
                        leader: formatLeader(leader),
                    },
                    HTTP_STATUS.CREATED
                );
            } catch (error) {
                if (
                    typeof error === "object" &&
                    error !== null &&
                    "code" in error &&
                    error.code === "P2002"
                ) {
                    return apiError(
                        c,
                        "User is already in Salary Leaders",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }
                logger.error(error);
                return apiError(
                    c,
                    "Failed to add salary leader",
                    HTTP_STATUS.INTERNAL_SERVER_ERROR
                );
            }
        }
    );

    app.openapi(
        createRoute({
            method: "delete",
            path: "/:userId",
            tags: ["Admin Salary Leaders"],
            summary: "Remove a user from salary leaders",
            request: {
                cookies: authCookie,
                params: z.object({ userId: z.string().uuid() }),
            },
            responses: {
                200: {
                    description: "User removed from salary leaders",
                    content: {
                        "application/json": {
                            schema: SalaryLeaderMutationResponseSchema,
                        },
                    },
                },
                ...CommonResponses.notFound(),
                ...CommonResponses.internalServerError(),
            },
        }),
        async (c) => {
            const { userId } = c.req.valid("param");

            try {
                const result = await prisma.salaryLeader.deleteMany({
                    where: { userId },
                });
                if (result.count === 0) {
                    return apiError(
                        c,
                        "Salary leader not found",
                        HTTP_STATUS.NOT_FOUND
                    );
                }

                return c.json(
                    {
                        success: true as const,
                        message: "User removed from Salary Leaders",
                    },
                    HTTP_STATUS.OK
                );
            } catch (error) {
                logger.error(error);
                return apiError(
                    c,
                    "Failed to remove salary leader",
                    HTTP_STATUS.INTERNAL_SERVER_ERROR
                );
            }
        }
    );
};
