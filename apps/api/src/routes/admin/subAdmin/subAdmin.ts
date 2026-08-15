import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";
import { createHash } from "crypto";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses, generateNextSerialNumber } from "@/lib/utils";
import { authCookie, limit, page, SubAdminItemSchema } from "@/schemas";
import { prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";

const logger = new Logger("admin-subadmin");

// List subadmins schema
const GetSubAdminsQuerySchema = z.object({
    page,
    limit,
});

const GetSubAdminsResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    subAdmins: z.array(SubAdminItemSchema),
    total: z.number().openapi({
        description: "Total number of sub-admins",
        example: 10,
    }),
    currentPage: z.number().openapi({
        description: "Current page number",
        example: 1,
    }),
    totalPages: z.number().openapi({
        description: "Total number of pages",
        example: 1,
    }),
});

// Create subadmin schema
const CreateSubAdminBodySchema = z.object({
    username: z.string().min(3).openapi({
        description: "Username for the sub-admin",
        example: "subadmin123",
    }),
    password: z.string().min(8).openapi({
        description: "Password for the sub-admin",
        example: "Password123!",
    }),
    mobileNumber: z
        .string()
        .regex(/^\d{10}$/, "Mobile number must be 10 digits")
        .openapi({
            description: "Mobile number for the sub-admin",
            example: "9876543210",
        }),
});

const CreateSubAdminResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the action was successful",
        example: true,
    }),
    message: z.string().openapi({
        description: "Result message",
        example: "Sub-admin created successfully",
    }),
    subAdmin: SubAdminItemSchema,
});

const getSubAdminsRoute = createRoute({
    method: "get",
    path: "/list",
    tags: ["admin"],
    summary: "List sub-admins",
    description: "Get a paginated list of sub-admins",
    request: {
        query: GetSubAdminsQuerySchema,
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: GetSubAdminsResponseSchema,
                },
            },
            description: "List of sub-admins",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

const createSubAdminRoute = createRoute({
    method: "post",
    path: "/create",
    tags: ["admin"],
    summary: "Create sub-admin",
    description: "Create a new sub-admin user with SUB_ADMIN role",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: CreateSubAdminBodySchema,
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: CreateSubAdminResponseSchema,
                },
            },
            description: "Sub-admin created successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

// Line 125 - Update function definition:
const createReferralCode = (serialNumber: number) => {
    const randomLength = 6;
    const randomNumbers = Array.from({ length: randomLength }, () =>
        Math.floor(Math.random() * 10)
    ).join("");

    return `${serialNumber}-${randomNumbers}`;
};


export const subAdminRoutes = (app: OpenAPIHono) => {
    app.openapi(getSubAdminsRoute, async (c) => {
        try {
            const { page, limit } = c.req.valid("query");

            const skip = (page - 1) * limit;

            // Check cache using hash-based caching
            const mainCacheKey = CacheKey.adminSubAdmins;
            const fieldKey = `page:${page}-limit:${limit}`;

            const cachedData = await Cache.hget<{
                subAdmins: Array<{
                    id: string;
                    serialNumber: number;
                    username: string;
                    mobileNumber: string;
                    role: string;
                    balance: number;
                    isBanned: boolean;
                    createdAt: string;
                }>;
                total: number;
                currentPage: number;
                totalPages: number;
            }>(mainCacheKey, fieldKey);

            if (cachedData) {
                return c.json(
                    {
                        success: true,
                        ...cachedData,
                    },
                    HTTP_STATUS.OK
                );
            }

            const where = {
                role: "SUB_ADMIN" as const,
            };

            const [subAdmins, total] = await Promise.all([
                prisma.user.findMany({
                    where,
                    take: limit,
                    skip,
                    orderBy: {
                        createdAt: "desc",
                    },
                    select: {
                        id: true,
                        serialNumber: true,
                        username: true,
                        mobileNumber: true,
                        role: true,
                        isBanned: true,
                        balance: true,
                        createdAt: true,
                    },
                }),
                prisma.user.count({ where }),
            ]);

            const totalPages = Math.ceil(total / limit);

            const result = {
                subAdmins: subAdmins.map((subAdmin) => ({
                    id: subAdmin.id,
                    balance: subAdmin.balance,
                    serialNumber: subAdmin.serialNumber,
                    username: subAdmin.username,
                    mobileNumber: subAdmin.mobileNumber,
                    role: subAdmin.role,
                    isBanned: subAdmin.isBanned,
                    createdAt: subAdmin.createdAt.toISOString(),
                })),
                total,
                currentPage: page,
                totalPages,
            };

            // Cache for 5 minutes
            await Cache.hset(mainCacheKey, fieldKey, result, 60 * 5);

            return c.json(
                {
                    success: true,
                    ...result,
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

    app.openapi(createSubAdminRoute, async (c) => {
        try {
            const { username, password, mobileNumber } = c.req.valid("json");

            // Check if username already exists
            const existingUser = await prisma.user.findFirst({
                where: {
                    OR: [{ username }, { mobileNumber }],
                },
            });

            if (existingUser) {
                if (existingUser.username === username) {
                    return apiError(
                        c,
                        "Username already exists",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }
                if (existingUser.mobileNumber === mobileNumber) {
                    return apiError(
                        c,
                        "Mobile number already exists",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }
            }

            const serialNumber = await generateNextSerialNumber();
            const referralCode = createReferralCode(serialNumber);

            // Create sub-admin user
            const subAdmin = await prisma.user.create({
                data: {
                    serialNumber,
                    username,
                    mobileNumber,
                    password: createHash("md5").update(password).digest("hex"),
                    referralCode,
                    role: "SUB_ADMIN",
                    balance: 0,
                },
                select: {
                    id: true,
                    serialNumber: true,
                    username: true,
                    mobileNumber: true,
                    balance: true,
                    role: true,
                    isBanned: true,
                    createdAt: true,
                },
            });


            // Invalidate cache
            await Cache.del(CacheKey.adminSubAdmins);

            return c.json(
                {
                    success: true,
                    message: "Sub-admin created successfully",
                    subAdmin: {
                        id: subAdmin.id,
                        serialNumber: subAdmin.serialNumber,
                        username: subAdmin.username,
                        mobileNumber: subAdmin.mobileNumber,
                        balance: subAdmin.balance,
                        role: subAdmin.role,
                        isBanned: subAdmin.isBanned,
                        createdAt: subAdmin.createdAt.toISOString(),
                    },
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
};
