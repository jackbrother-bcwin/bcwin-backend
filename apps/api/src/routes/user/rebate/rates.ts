import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import { Cache, CacheKey } from "@bcwin/cache";

const logger = new Logger("rebate-rates");

const layerSchema = z.object({
    vipLevel: z.number(),
    layer1: z.number(),
    layer2: z.number(),
    layer3: z.number(),
    layer4: z.number(),
    layer5: z.number(),
    layer6: z.number(),
});

const ratesResponseSchema = z.object({
    success: z.boolean(),
    data: z.object({
        lottery: z.array(layerSchema),
        slots: z.array(layerSchema),
        casino: z.array(layerSchema),
        sports: z.array(layerSchema),
        rummy: z.array(layerSchema),
    }),
});

const getRebateRatesRoute = createRoute({
    method: "get",
    tags: ["user"],
    path: "/rates",
    summary: "Get multi-level rebate rates by category",
    description:
        "VIP L0–L10 × layers 1–6 rates for LOTTERY / SLOTS / CASINO / SPORTS / RUMMY (team rebate)",
    request: { cookies: authCookie },
    responses: {
        200: {
            content: {
                "application/json": { schema: ratesResponseSchema },
            },
            description: "Rates loaded",
        },
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

const CACHE_KEY = "rebate:rates:by-category";

export const rebateRatesRoutes = (app: OpenAPIHono) => {
    app.openapi(getRebateRatesRoute, async (c) => {
        try {
            const cached = await Cache.get<z.infer<typeof ratesResponseSchema>["data"]>(
                CACHE_KEY
            );
            if (cached) {
                return c.json({ success: true, data: cached }, HTTP_STATUS.OK);
            }

            const rows = await prisma.rebateRateConfig.findMany({
                orderBy: [{ category: "asc" }, { vipLevel: "asc" }],
            });

            const empty = () =>
                [] as {
                    vipLevel: number;
                    layer1: number;
                    layer2: number;
                    layer3: number;
                    layer4: number;
                    layer5: number;
                    layer6: number;
                }[];

            const data = {
                lottery: empty(),
                slots: empty(),
                casino: empty(),
                sports: empty(),
                rummy: empty(),
            };

            for (const r of rows) {
                const item = {
                    vipLevel: r.vipLevel,
                    layer1: r.layer1,
                    layer2: r.layer2,
                    layer3: r.layer3,
                    layer4: r.layer4,
                    layer5: r.layer5,
                    layer6: r.layer6,
                };
                const key = r.category.toLowerCase() as keyof typeof data;
                if (data[key]) data[key].push(item);
            }

            await Cache.set(CACHE_KEY, data, 60 * 60);

            return c.json({ success: true, data }, HTTP_STATUS.OK);
        } catch (error) {
            logger.error("Error loading rebate rates:", error);
            return apiError(
                c,
                "Failed to load rebate rates",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
