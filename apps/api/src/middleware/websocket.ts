import { Context, Next } from "hono";
import { z } from "@hono/zod-openapi";
import { getCookie } from "hono/cookie";

import { HTTP_STATUS } from "../lib/http";
import { middlewareApiError } from "../lib/utils";
import { AUTH_COOKIE_NAME, decodeJwt } from "@/lib/auth";
import { prisma } from "@bcwin/db";

const websocketQuerySchema = z.object({
    id: z.uuid().describe("A unique identifier for the client connection."),
});

export const websocketMiddleware = async (c: Context, next: Next) => {
    const query = c.req.query();
    const result = websocketQuerySchema.safeParse(query);

    if (!result.success) {
        return middlewareApiError(
            c,
            "Invalid or missing 'id' query parameter. It must be a valid UUID.",
            HTTP_STATUS.BAD_REQUEST
        );
    }

    c.set("validatedId", result.data.id);

    const authCookie = getCookie(c, AUTH_COOKIE_NAME);

    // user is not authenticated
    if (!authCookie) {
        await next();
        return;
    }

    try {
        const decoded = await decodeJwt(authCookie);

        const user = await prisma.user.findUnique({
            where: {
                id: decoded.userId,
            },
        });

        if (!user) {
            return middlewareApiError(
                c,
                "Invalid or expired token",
                HTTP_STATUS.UNAUTHORIZED
            );
        }

        c.set("user", user);
    } catch (error) {
        return middlewareApiError(
            c,
            "Authentication failed",
            HTTP_STATUS.UNAUTHORIZED
        );
    }

    await next();
};
