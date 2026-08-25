import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie, limit, page } from "@/schemas";
import { Gift, prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import { mintGiftCode } from "@/lib/giftCode";

const logger = new Logger("admin-gift");

const GetGiftsSchema = z.object({
    page,
    limit,
});

const GetGiftsResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the gifts were fetched successfully",
        example: true,
    }),
    gifts: z.array(
        z.object({
            id: z.string().openapi({
                description: "The id of the gift",
                example: "123456",
            }),
            code: z.string().openapi({
                description: "The code of the gift",
                example: "BCWIN0XK7M2Q9P4",
            }),
            amount: z.number().openapi({
                description: "The amount of the gift",
                example: 200,
            }),
            totalRedeemed: z.number().openapi({
                description:
                    "The total number of times the gift has been redeemed",
                example: 50,
            }),
            totalRedeemable: z.number().openapi({
                description:
                    "The total number of times the gift can be redeemed",
                example: 100,
            }),
            type: z.enum(["FIXED", "UPTO"]).openapi({
                description:
                    "The type of the gift. FIXED means the amount is fixed for each gift. UPTO means the amount is upto the amount user can redeem",
                example: "FIXED",
            }),
            validTill: z.iso.datetime().optional().nullable().openapi({
                description:
                    "The date and time until which the gift is valid. If not provided, the gift will be valid forever",
                example: "2025-01-01T00:00:00Z",
            }),
            validFrom: z.iso.datetime().optional().nullable().openapi({
                description:
                    "The date and time from which the gift is valid. If not provided, the gift will be valid from the current date and time",
                example: "2025-01-01T00:00:00Z",
            }),
            isActive: z.boolean().default(true).openapi({
                description:
                    "Whether the gift is active. If not provided, the gift will be active",
                example: true,
                default: true,
            }),
            title: z.string().optional().nullable().openapi({
                description: "The title of the gift",
                example: "Free Gift",
            }),
            description: z.string().optional().nullable().openapi({
                description: "The description of the gift",
                example: "This is a free gift for you",
            }),
        })
    ),
});

const CreateGiftSchema = z.object({
    totalRedeemable: z.number().min(1).openapi({
        description: "The total number of times the gift can be redeemed",
        example: 5,
    }),
    amount: z.number().min(1).openapi({
        description:
            "The amount of the gift. If type is FIXED, this is the amount of each gift. If type is UPTO, this is maximum amount of each gift user can redeem",
        example: 100,
    }),
    type: z.enum(["FIXED", "UPTO"]).openapi({
        description:
            "The type of the gift. FIXED means the amount is fixed for each gift. UPTO means the amount is upto the amount user can redeem",
        example: "FIXED",
    }),
    validTill: z.iso.datetime().optional().openapi({
        description:
            "The date and time until which the gift is valid. If not provided, the gift will be valid forever",
        example: "2025-01-01T00:00:00Z",
    }),
    validFrom: z.iso.datetime().optional().openapi({
        description:
            "The date and time from which the gift is valid. If not provided, the gift will be valid from the current date and time",
        example: "2025-01-01T00:00:00Z",
    }),
    isActive: z.boolean().default(true).openapi({
        description:
            "Whether the gift is active. If not provided, the gift will be active",
        example: true,
        default: true,
    }),
    title: z.string().optional().openapi({
        description: "The title of the gift",
        example: "Free Gift",
    }),
    description: z.string().optional().openapi({
        description: "The description of the gift",
        example: "This is a free gift for you",
    }),
});

const CreateGiftResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the gifts were fetched successfully",
        example: true,
    }),
    amount: z.number().openapi({
        description: "The amount of each gift",
        example: 200,
    }),
    code: z.string().openapi({
        description: "The redeemable code for the gift",
        example: "BCWIN0XK7M2Q9P4",
    }),
    totalRedeemable: z.number().openapi({
        description: "The total number of times the gift can be redeemed",
        example: 5,
    }),
});

const UpdateGiftIsActiveSchema = z.object({
    isActive: z.boolean().openapi({
        description: "Whether the gift should be active or not",
        example: true,
    }),
});

const UpdateGiftIsActiveResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the gift was updated successfully",
        example: true,
    }),
    message: z.string().openapi({
        description: "Success message",
        example: "Gift status updated successfully",
    }),
    gift: z.object({
        id: z.string().openapi({
            description: "The id of the gift",
            example: "123456",
        }),
        code: z.string().openapi({
            description: "The code of the gift",
            example: "BCWIN0XK7M2Q9P4",
        }),
        isActive: z.boolean().openapi({
            description: "The updated active status of the gift",
            example: true,
        }),
    }),
});

const getGiftsRoute = createRoute({
    method: "post",
    path: "/gifts",
    tags: ["admin"],
    summary: "Get gifts",
    description: "Get gifts",
    request: {
        cookies: authCookie,
        query: GetGiftsSchema,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: GetGiftsResponseSchema,
                },
            },
            description: "Get gifts",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.notFound(),
        ...CommonResponses.internalServerError(),
    },
});

const createGiftRoute = createRoute({
    method: "post",
    path: "/create",
    tags: ["admin"],
    summary: "Create a gift",
    description:
        "Create a gift by providing the total redeemable and total amount",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: CreateGiftSchema,
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: CreateGiftResponseSchema,
                },
            },
            description: "Create a gift",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.notFound(),
        ...CommonResponses.internalServerError(),
    },
});

const updateGiftIsActiveRoute = createRoute({
    method: "patch",
    path: "/:giftId",
    tags: ["admin"],
    summary: "Update gift active status",
    description: "Update the isActive status of a gift",
    request: {
        params: z.object({
            giftId: z.string().openapi({
                description: "The ID of the gift to update",
                example: "123456",
            }),
        }),
        body: {
            content: {
                "application/json": {
                    schema: UpdateGiftIsActiveSchema,
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: UpdateGiftIsActiveResponseSchema,
                },
            },
            description: "Gift status updated successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.notFound(),
        ...CommonResponses.internalServerError(),
    },
});

export const giftRoutes = (app: OpenAPIHono) => {
    app.openapi(getGiftsRoute, async (c) => {
        try {
            const { page, limit } = c.req.valid("query");

            const skip = (page - 1) * limit;

            // Check cache using hash-based caching
            const fieldKey = `page:${page}-limit:${limit}`;

            const cachedData = await Cache.hget<{
                gifts: Array<Gift>;
                total: number;
                currentPage: number;
                totalPages: number;
            }>(CacheKey.adminGifts, fieldKey);

            if (cachedData) {
                return c.json(
                    {
                        success: true,
                        ...cachedData,
                    },
                    HTTP_STATUS.OK
                );
            }

            const [gifts, total] = await Promise.all([
                prisma.gift.findMany({
                    take: limit,
                    skip,
                    orderBy: {
                        updatedAt: "desc",
                    },
                }),
                prisma.gift.count(),
            ]);

            const totalPages = Math.ceil(total / limit);

            const result = {
                gifts: gifts.map((gift) => gift),
                total,
                currentPage: page,
                totalPages,
            };

            // Cache for 5 minutes
            await Cache.hset(CacheKey.adminGifts, fieldKey, result, 60 * 5);

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

    app.openapi(createGiftRoute, async (c) => {
        try {
            const {
                totalRedeemable,
                amount,
                type,
                validTill,
                validFrom,
                isActive,
                title,
                description,
            } = c.req.valid("json");

            const giftCode = await mintGiftCode(async (code) => {
                await prisma.gift.create({
                    data: {
                        amount,
                        type,
                        totalRedeemable,
                        code,
                        totalRedeemed: 0,
                        validTill,
                        validFrom,
                        isActive,
                        title,
                        description,
                    },
                });
            });

            // Invalidate gifts cache when new gift is created
            await Cache.del(CacheKey.adminGifts);

            return c.json(
                {
                    success: true,
                    amount,
                    code: giftCode,
                    totalRedeemable,
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

    app.openapi(updateGiftIsActiveRoute, async (c) => {
        try {
            const { giftId } = c.req.valid("param");
            const { isActive } = c.req.valid("json");

            // Check if gift exists
            const existingGift = await prisma.gift.findUnique({
                where: { id: giftId },
            });

            if (!existingGift) {
                return apiError(c, "Gift not found", HTTP_STATUS.NOT_FOUND);
            }

            // Update the gift's isActive status
            const updatedGift = await prisma.gift.update({
                where: { id: giftId },
                data: { isActive },
                select: {
                    id: true,
                    code: true,
                    isActive: true,
                },
            });

            // Invalidate gifts cache
            await Cache.del(CacheKey.adminGifts);

            return c.json(
                {
                    success: true,
                    message: "Gift status updated successfully",
                    gift: updatedGift,
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
