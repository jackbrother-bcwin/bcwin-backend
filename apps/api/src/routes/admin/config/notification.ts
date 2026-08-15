import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie, limit, page } from "@/schemas";
import { prisma, NotificationType, NotificationImportance } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";

const logger = new Logger("admin-config-notification");

// Notification schema
const NotificationSchema = z.object({
    id: z.string().openapi({
        description: "Notification ID",
        example: "uuid-123",
    }),
    title: z.string().openapi({
        description: "Notification title",
        example: "System Update",
    }),
    message: z.string().openapi({
        description: "Notification message",
        example: "We will be performing maintenance tonight.",
    }),
    type: z.enum(NotificationType).openapi({
        description: "Notification type",
        example: NotificationType.GLOBAL,
    }),
    importance: z.enum(NotificationImportance).openapi({
        description: "Notification importance level",
        example: NotificationImportance.MEDIUM,
    }),
    isActive: z.boolean().openapi({
        description: "Whether the notification is active",
        example: true,
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

// List
const GetNotificationsQuerySchema = z.object({
    page,
    limit,
});

const GetNotificationsResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    notifications: z.array(NotificationSchema),
    total: z.number().openapi({
        description: "Total number of notifications",
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

// Create
const CreateNotificationBodySchema = z.object({
    title: z.string().min(1).openapi({
        description: "Notification title",
        example: "System Update",
    }),
    message: z.string().min(1).openapi({
        description: "Notification message",
        example: "We will be performing maintenance tonight.",
    }),
    type: z.enum(NotificationType).optional().openapi({
        description: "Notification type",
        example: NotificationType.GLOBAL,
    }),
    importance: z.enum(NotificationImportance).optional().openapi({
        description: "Notification importance level",
        example: NotificationImportance.MEDIUM,
    }),
    isActive: z.boolean().optional().default(true).openapi({
        description: "Whether the notification is active",
        example: true,
    }),
});

const CreateNotificationResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the notification was created successfully",
        example: true,
    }),
    message: z.string().openapi({
        description: "Result message",
        example: "Notification created successfully",
    }),
    notification: NotificationSchema,
});

// Update
const UpdateNotificationBodySchema = z.object({
    title: z.string().min(1).optional().openapi({
        description: "Notification title",
        example: "Updated Title",
    }),
    message: z.string().min(1).optional().openapi({
        description: "Notification message",
        example: "Updated message content.",
    }),
    type: z.enum(NotificationType).optional().openapi({
        description: "Notification type",
        example: NotificationType.GLOBAL,
    }),
    importance: z.enum(NotificationImportance).optional().openapi({
        description: "Notification importance level",
        example: NotificationImportance.HIGH,
    }),
    isActive: z.boolean().optional().openapi({
        description: "Whether the notification is active",
        example: true,
    }),
});

const UpdateNotificationResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the notification was updated successfully",
        example: true,
    }),
    message: z.string().openapi({
        description: "Result message",
        example: "Notification updated successfully",
    }),
    notification: NotificationSchema,
});

// Delete
const DeleteNotificationResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the notification was deleted successfully",
        example: true,
    }),
    message: z.string().openapi({
        description: "Result message",
        example: "Notification deleted successfully",
    }),
});

// Route definitions
const getNotificationsRoute = createRoute({
    method: "get",
    path: "/",
    tags: ["admin", "config"],
    summary: "List all notifications",
    description: "Get a paginated list of all notifications",
    request: {
        query: GetNotificationsQuerySchema,
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: GetNotificationsResponseSchema,
                },
            },
            description: "Notifications retrieved successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

const createNotificationRoute = createRoute({
    method: "post",
    path: "/",
    tags: ["admin", "config"],
    summary: "Create a notification",
    description: "Create a new notification",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: CreateNotificationBodySchema,
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: CreateNotificationResponseSchema,
                },
            },
            description: "Notification created successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

const updateNotificationRoute = createRoute({
    method: "patch",
    path: "/:id",
    tags: ["admin", "config"],
    summary: "Update a notification",
    description: "Update an existing notification",
    request: {
        params: z.object({
            id: z.string().openapi({
                description: "Notification ID",
                example: "uuid-123",
            }),
        }),
        body: {
            content: {
                "application/json": {
                    schema: UpdateNotificationBodySchema,
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: UpdateNotificationResponseSchema,
                },
            },
            description: "Notification updated successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

const deleteNotificationRoute = createRoute({
    method: "delete",
    path: "/:id",
    tags: ["admin", "config"],
    summary: "Delete a notification",
    description: "Delete a notification permanently",
    request: {
        params: z.object({
            id: z.string().openapi({
                description: "Notification ID",
                example: "uuid-123",
            }),
        }),
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: DeleteNotificationResponseSchema,
                },
            },
            description: "Notification deleted successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

const formatNotification = (n: any) => ({
    id: n.id,
    title: n.title,
    message: n.message,
    type: n.type,
    importance: n.importance,
    isActive: n.isActive,
    createdAt: n.createdAt instanceof Date ? n.createdAt.toISOString() : n.createdAt,
    updatedAt: n.updatedAt instanceof Date ? n.updatedAt.toISOString() : n.updatedAt,
});

// Route handlers
export const notificationRoutes = (app: OpenAPIHono) => {
    // List notifications
    app.openapi(getNotificationsRoute, async (c) => {
        try {
            const { page, limit } = c.req.valid("query");
            const skip = (page - 1) * limit;

            // Check cache
            const mainCacheKey = CacheKey.adminNotifications;
            const fieldKey = `page:${page}-limit:${limit}`;

            const cachedData = await Cache.hget<{
                notifications: any[];
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

            const [notifications, total] = await Promise.all([
                prisma.notification.findMany({
                    take: limit,
                    skip,
                    orderBy: {
                        createdAt: "desc",
                    },
                }),
                prisma.notification.count(),
            ]);

            const totalPages = Math.ceil(total / limit);

            const result = {
                notifications: notifications.map(formatNotification),
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

    // Create notification
    app.openapi(createNotificationRoute, async (c) => {
        try {
            const { title, message, type, importance, isActive } =
                c.req.valid("json");

            const notification = await prisma.notification.create({
                data: {
                    title,
                    message,
                    type: type ?? NotificationType.GLOBAL,
                    importance: importance ?? NotificationImportance.LOW,
                    isActive: isActive ?? true,
                },
            });

            // Invalidate caches
            await Promise.all([
                Cache.del(CacheKey.adminNotifications),
                Cache.del(CacheKey.userNotifications),
            ]);

            logger.info("Notification created", { id: notification.id, title });

            return c.json(
                {
                    success: true,
                    message: "Notification created successfully",
                    notification: formatNotification(notification),
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

    // Update notification
    app.openapi(updateNotificationRoute, async (c) => {
        try {
            const { id } = c.req.valid("param");
            const updates = c.req.valid("json");

            // Check if notification exists
            const existing = await prisma.notification.findUnique({
                where: { id },
            });

            if (!existing) {
                return apiError(
                    c,
                    "Notification not found",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            const updateData: any = {};
            if (updates.title !== undefined) updateData.title = updates.title;
            if (updates.message !== undefined)
                updateData.message = updates.message;
            if (updates.type !== undefined) updateData.type = updates.type;
            if (updates.importance !== undefined)
                updateData.importance = updates.importance;
            if (updates.isActive !== undefined)
                updateData.isActive = updates.isActive;

            const notification = await prisma.notification.update({
                where: { id },
                data: updateData,
            });

            // Invalidate caches
            await Promise.all([
                Cache.del(CacheKey.adminNotifications),
                Cache.del(CacheKey.userNotifications),
            ]);

            logger.info("Notification updated", { id });

            return c.json(
                {
                    success: true,
                    message: "Notification updated successfully",
                    notification: formatNotification(notification),
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

    // Delete notification
    app.openapi(deleteNotificationRoute, async (c) => {
        try {
            const { id } = c.req.valid("param");

            // Check if notification exists
            const existing = await prisma.notification.findUnique({
                where: { id },
            });

            if (!existing) {
                return apiError(
                    c,
                    "Notification not found",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            await prisma.notification.delete({
                where: { id },
            });

            // Invalidate caches
            await Promise.all([
                Cache.del(CacheKey.adminNotifications),
                Cache.del(CacheKey.userNotifications),
            ]);

            logger.info("Notification deleted", { id });

            return c.json(
                {
                    success: true,
                    message: "Notification deleted successfully",
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
