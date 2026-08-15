import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import { CommissionRateConfig, prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";

const logger = new Logger("admin-config-commission-rate");

// Commission rate config schema
const CommissionRateConfigSchema = z.object({
    id: z.string().openapi({
        description: "Commission rate config ID",
        example: "uuid-123",
    }),
    vipLevel: z.number().min(0).max(10).openapi({
        description: "VIP level (0-10)",
        example: 0,
    }),
    layer1: z.number().min(0).max(1).openapi({
        description: "Commission rate for layer 1 (0-1)",
        example: 0.4,
    }),
    layer2: z.number().min(0).max(1).openapi({
        description: "Commission rate for layer 2 (0-1)",
        example: 0.1,
    }),
    layer3: z.number().min(0).max(1).openapi({
        description: "Commission rate for layer 3 (0-1)",
        example: 0.05,
    }),
    layer4: z.number().min(0).max(1).openapi({
        description: "Commission rate for layer 4 (0-1)",
        example: 0.03,
    }),
    layer5: z.number().min(0).max(1).openapi({
        description: "Commission rate for layer 5 (0-1)",
        example: 0.02,
    }),
    layer6: z.number().min(0).max(1).openapi({
        description: "Commission rate for layer 6 (0-1)",
        example: 0.01,
    }),
    createdAt: z.string().openapi({
        description: "Creation timestamp",
        example: "2025-01-12T10:30:00Z",
    }),
    updatedAt: z.string().openapi({
        description: "Last update timestamp",
        example: "2025-01-12T10:30:00Z",
    }),
});

// Get all commission rates response
const GetCommissionRatesResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    rates: z.array(CommissionRateConfigSchema),
});

// Update commission rate request schema
const UpdateCommissionRateBodySchema = z.object({
    vipLevel: z.number().min(0).max(10).openapi({
        description: "VIP level to update (0-10)",
        example: 0,
    }),
    layer1: z.number().min(0).max(1).openapi({
        description: "Commission rate for layer 1 (0-1)",
        example: 0.4,
    }),
    layer2: z.number().min(0).max(1).openapi({
        description: "Commission rate for layer 2 (0-1)",
        example: 0.1,
    }),
    layer3: z.number().min(0).max(1).openapi({
        description: "Commission rate for layer 3 (0-1)",
        example: 0.05,
    }),
    layer4: z.number().min(0).max(1).openapi({
        description: "Commission rate for layer 4 (0-1)",
        example: 0.03,
    }),
    layer5: z.number().min(0).max(1).openapi({
        description: "Commission rate for layer 5 (0-1)",
        example: 0.02,
    }),
    layer6: z.number().min(0).max(1).openapi({
        description: "Commission rate for layer 6 (0-1)",
        example: 0.01,
    }),
});

const UpdateCommissionRateResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the action was successful",
        example: true,
    }),
    message: z.string().openapi({
        description: "Result message",
        example: "Commission rate updated successfully",
    }),
    rate: CommissionRateConfigSchema,
});

// Routes
const getCommissionRatesRoute = createRoute({
    method: "get",
    path: "/",
    tags: ["admin", "config"],
    summary: "Get all commission rate configurations",
    description: "Get commission rates for all VIP levels",
    request: {
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: GetCommissionRatesResponseSchema,
                },
            },
            description: "Commission rates retrieved successfully",
        },
        ...CommonResponses.internalServerError(),
    },
});

const updateCommissionRateRoute = createRoute({
    method: "put",
    path: "/",
    tags: ["admin", "config"],
    summary: "Update commission rate configuration",
    description:
        "Update commission rates for a specific VIP level. Creates new config if not exists.",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: UpdateCommissionRateBodySchema,
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: UpdateCommissionRateResponseSchema,
                },
            },
            description: "Commission rate updated successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

export const commissionRateRoutes = (app: OpenAPIHono) => {
    app.openapi(getCommissionRatesRoute, async (c) => {
        try {
            // Check cache first
            const cacheKey = CacheKey.commissionRates;
            const cachedData = await Cache.get<Array<CommissionRateConfig>>(
                cacheKey
            );

            if (cachedData) {
                return c.json(
                    {
                        success: true,
                        rates: cachedData,
                    },
                    HTTP_STATUS.OK
                );
            }

            const rates = await prisma.commissionRateConfig.findMany({
                orderBy: {
                    vipLevel: "asc",
                },
            });

            const formattedRates = rates.map((rate) => ({
                id: rate.id,
                vipLevel: rate.vipLevel,
                layer1: rate.layer1,
                layer2: rate.layer2,
                layer3: rate.layer3,
                layer4: rate.layer4,
                layer5: rate.layer5,
                layer6: rate.layer6,
                createdAt: rate.createdAt.toISOString(),
                updatedAt: rate.updatedAt.toISOString(),
            }));

            // Cache for 1 hour (since config changes rarely)
            await Cache.set(cacheKey, formattedRates, 60 * 60);

            return c.json(
                {
                    success: true,
                    rates: formattedRates,
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

    app.openapi(updateCommissionRateRoute, async (c) => {
        try {
            const { vipLevel, layer1, layer2, layer3, layer4, layer5, layer6 } =
                c.req.valid("json");

            // Validate that rates are descending (layer1 >= layer2 >= ... >= layer6)
            const layers = [layer1, layer2, layer3, layer4, layer5, layer6];
            for (let i = 0; i < layers.length - 1; i++) {
                if (layers[i] < layers[i + 1]) {
                    return apiError(
                        c,
                        "Commission rates must be in descending order (layer1 >= layer2 >= ... >= layer6)",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }
            }

            // Upsert (update if exists, create if not)
            const rate = await prisma.commissionRateConfig.upsert({
                where: {
                    vipLevel,
                },
                update: {
                    layer1,
                    layer2,
                    layer3,
                    layer4,
                    layer5,
                    layer6,
                },
                create: {
                    vipLevel,
                    layer1,
                    layer2,
                    layer3,
                    layer4,
                    layer5,
                    layer6,
                },
            });

            logger.info(
                `Commission rate updated for VIP level ${vipLevel}: [${layer1}, ${layer2}, ${layer3}, ${layer4}, ${layer5}, ${layer6}]`
            );

            // Invalidate cache
            await Cache.del(CacheKey.commissionRates);

            return c.json(
                {
                    success: true,
                    message: "Commission rate updated successfully",
                    rate: {
                        id: rate.id,
                        vipLevel: rate.vipLevel,
                        layer1: rate.layer1,
                        layer2: rate.layer2,
                        layer3: rate.layer3,
                        layer4: rate.layer4,
                        layer5: rate.layer5,
                        layer6: rate.layer6,
                        createdAt: rate.createdAt.toISOString(),
                        updatedAt: rate.updatedAt.toISOString(),
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
