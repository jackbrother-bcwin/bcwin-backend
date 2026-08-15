import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import { prisma, QueryStatus } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";

const logger = new Logger("admin-queries-update-status");

// Update status schema
const UpdateStatusParamsSchema = z.object({
    id: z.string().openapi({
        description: "Query ID",
        example: "uuid-123",
    }),
});

const UpdateStatusBodySchema = z.object({
    status: z.nativeEnum(QueryStatus).openapi({
        description: "New status for the query",
        example: "VERIFIED",
    }),
    adminNotes: z.string().optional().openapi({
        description: "Optional admin notes/remarks",
        example: "Verified transaction, processing refund",
    }),
});

const UpdateStatusResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the update was successful",
        example: true,
    }),
    message: z.string().openapi({
        description: "Result message",
        example: "Query status updated successfully",
    }),
    query: z.object({
        id: z.string(),
        ticketId: z.string(),
        status: z.string(),
        adminNotes: z.string().nullable().optional(),
        updatedAt: z.string(),
    }),
});

const updateStatusRoute = createRoute({
    method: "patch",
    path: "/:id/status",
    tags: ["admin"],
    summary: "Update query status",
    description:
        "Update the status of a user query. Valid transitions follow the workflow: CREATED → VERIFIED → PROCESSING → COMPLETED/REJECTED",
    request: {
        params: UpdateStatusParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: UpdateStatusBodySchema,
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: UpdateStatusResponseSchema,
                },
            },
            description: "Query status updated successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

export const updateStatusRoutes = (app: OpenAPIHono) => {
    app.openapi(updateStatusRoute, async (c) => {
        try {
            const { id } = c.req.valid("param");
            const { status, adminNotes } = c.req.valid("json");

            // Find the query
            const query = await prisma.userQuery.findUnique({
                where: { id },
            });

            if (!query) {
                return apiError(
                    c,
                    "Query not found",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            // Prepare update data
            const updateData: any = {
                status,
                updatedAt: new Date(),
            };

            // Add adminNotes if provided
            if (adminNotes !== undefined) {
                updateData.adminNotes = adminNotes;
            }

            // Set resolvedAt timestamp when marking as COMPLETED or REJECTED
            if (
                (status === QueryStatus.COMPLETED ||
                    status === QueryStatus.REJECTED) &&
                !query.resolvedAt
            ) {
                updateData.resolvedAt = new Date();
            }

            // Update the query
            const updatedQuery = await prisma.userQuery.update({
                where: { id },
                data: updateData,
            });

            // Invalidate query caches
            await Cache.del(CacheKey.adminQueries);
            await Cache.del(CacheKey.userQueries(query.userId));

            return c.json(
                {
                    success: true,
                    message: "Query status updated successfully",
                    query: {
                        id: updatedQuery.id,
                        ticketId: updatedQuery.ticketId,
                        status: updatedQuery.status,
                        adminNotes: updatedQuery.adminNotes,
                        updatedAt: updatedQuery.updatedAt.toISOString(),
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
