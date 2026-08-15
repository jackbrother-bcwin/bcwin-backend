import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import { CommissionRateConfig, prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import { commissionRateSchema } from "@/schemas/vip";
import { Cache, CacheKey } from "@bcwin/cache";

const logger = new Logger("commission-rate-routes");

const commissionRatesResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    data: z.array(commissionRateSchema).openapi({
        description: "Array of commission rates by VIP level",
    }),
});

const getCommissionRatesRoute = createRoute({
    method: "get",
    tags: ["user"],
    path: "/rates",
    summary: "Get commission rates for all VIP levels",
    description: "Retrieve commission rates by layer for all VIP levels",
    request: {
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: commissionRatesResponseSchema,
                },
            },
            description: "Successfully retrieved commission rates",
        },
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

export const rateRoutes = (app: OpenAPIHono) => {
    app.openapi(getCommissionRatesRoute, async (c) => {
        try {
            // Check cache first - static config data, long TTL
            const cachedRates = await Cache.get<Array<CommissionRateConfig>>(
                CacheKey.commissionRates
            );

            if (cachedRates) {
                return c.json(
                    {
                        success: true,
                        data: cachedRates,
                    },
                    HTTP_STATUS.OK
                );
            }

            const rates = await prisma.commissionRateConfig.findMany({
                orderBy: { vipLevel: "asc" },
            });

            const ratesData = rates.map((rate) => ({
                vipLevel: rate.vipLevel,
                layer1: rate.layer1,
                layer2: rate.layer2,
                layer3: rate.layer3,
                layer4: rate.layer4,
                layer5: rate.layer5,
                layer6: rate.layer6,
            }));

            // Cache for 1 hour - static config data
            await Cache.set(CacheKey.commissionRates, ratesData, 60 * 60);

            return c.json(
                {
                    success: true,
                    data: ratesData,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error fetching commission rates:", error);
            return apiError(
                c,
                "Failed to fetch commission rates",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
