import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import { prisma, NotificationType, NotificationImportance } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";

const logger = new Logger("user-notifications");

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
    createdAt: z.string().openapi({
        description: "Creation timestamp",
        example: "2025-01-12T10:30:00Z",
    }),
});

const GetUserNotificationsResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    notifications: z.array(NotificationSchema),
});

const getUserNotificationsRoute = createRoute({
    method: "get",
    path: "/notifications",
    tags: ["user"],
    summary: "Get notifications",
    description: "Get all active notifications for the user",
    request: {
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: GetUserNotificationsResponseSchema,
                },
            },
            description: "Notifications retrieved successfully",
        },
        ...CommonResponses.internalServerError(),
    },
});

export const userNotificationRoutes = (app: OpenAPIHono) => {
    app.openapi(getUserNotificationsRoute, async (c) => {
        try {
            // Check cache
            const cachedData = await Cache.get<any[]>(
                CacheKey.userNotifications
            );

            if (cachedData) {
                return c.json(
                    {
                        success: true,
                        notifications: cachedData,
                    },
                    HTTP_STATUS.OK
                );
            }

            const notifications = await prisma.notification.findMany({
                where: {
                    isActive: true,
                },
                orderBy: {
                    createdAt: "desc",
                },
                select: {
                    id: true,
                    title: true,
                    message: true,
                    type: true,
                    importance: true,
                    createdAt: true,
                },
            });

            const formatted = notifications.map((n) => ({
                id: n.id,
                title: n.title,
                message: n.message,
                type: n.type,
                importance: n.importance,
                createdAt: n.createdAt.toISOString(),
            }));

            // Cache for 5 minutes
            await Cache.set(CacheKey.userNotifications, formatted, 60 * 5);

            return c.json(
                {
                    success: true,
                    notifications: formatted,
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
