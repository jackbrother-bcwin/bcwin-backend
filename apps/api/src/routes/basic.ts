import { OpenAPIHono, z, createRoute } from "@hono/zod-openapi";

import { Cache } from "@bcwin/cache";
import { prisma } from "@bcwin/db";
import { HTTP_STATUS } from "@/lib/http";

const serviceStatusSchema = z
    .object({
        status: z.enum(["healthy", "unhealthy"]),
        message: z.string().optional().openapi({
            description: "An optional message, usually present on failure.",
            example: "Connection timed out",
        }),
    })
    .openapi({
        title: "ServiceStatus",
        description: "The status of a service",
        example: {
            status: "healthy",
        },
    });

const healthResponseSchema = z
    .object({
        status: z.enum(["ok", "error"]).openapi({
            description: "The overall status of the application.",
            example: "ok",
        }),
        timestamp: z.iso.datetime().openapi({
            description: "The ISO 8601 timestamp when the check was performed.",
        }),
        services: z.object({
            api: serviceStatusSchema,
            database: serviceStatusSchema,
            cache: serviceStatusSchema,
        }),
    })
    .openapi({
        title: "HealthStatus",
        description: "The status of the application",
        example: {
            status: "ok",
        },
    });

const healthRoute = createRoute({
    method: "get",
    path: "/health",
    responses: {
        200: {
            content: { "application/json": { schema: healthResponseSchema } },
            description: "All services are healthy and operational.",
        },
        503: {
            content: { "application/json": { schema: healthResponseSchema } },
            description: "One or more services are unavailable.",
        },
    },
});

type HealthResponse = z.infer<typeof healthResponseSchema>;

export const basicRoutes = (app: OpenAPIHono) => {
    app.openapi(healthRoute, async (c) => {
        const checkDatabase = async () => {
            try {
                await prisma.$queryRaw`SELECT 1`;
                return { status: "healthy" as const };
            } catch (error) {
                return {
                    status: "unhealthy" as const,
                    message: "Database connection failed",
                };
            }
        };

        const checkCache = async () => {
            const isHealthy = await Cache.ping();
            if (isHealthy) {
                return { status: "healthy" as const };
            }
            return {
                status: "unhealthy" as const,
                message: "Ping to Redis failed or timed out.",
            };
        };

        const [databaseResult, cacheResult] = await Promise.all([
            checkDatabase(),
            checkCache(),
        ]);

        const isHealthy =
            databaseResult.status === "healthy" &&
            cacheResult.status === "healthy";

        const responseBody: HealthResponse = {
            status: isHealthy ? "ok" : "error",
            timestamp: new Date().toISOString(),
            services: {
                api: { status: "healthy" as const },
                database: databaseResult,
                cache: cacheResult,
            },
        };

        const httpStatus = isHealthy
            ? HTTP_STATUS.OK
            : HTTP_STATUS.SERVICE_UNAVAILABLE;
        c.status(httpStatus);

        return c.json(responseBody);
    });
};
