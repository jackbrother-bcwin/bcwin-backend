import { Context, Next } from "hono";
import { getCookie } from "hono/cookie";

import Logger from "@bcwin/logger";
import { prisma } from "@bcwin/db";
import { HTTP_STATUS } from "../lib/http";
import { middlewareApiError } from "../lib/utils";
import { AUTH_COOKIE_NAME, decodeJwt } from "../lib/auth";
import { authCatchResponse } from "../lib/dbError";

const logger = new Logger("auth-middleware");

export const authMiddleware = async (c: Context, next: Next) => {
    try {
        const authCookie = getCookie(c, AUTH_COOKIE_NAME);

        if (!authCookie) {
            return middlewareApiError(
                c,
                "Authorization cookie required",
                HTTP_STATUS.UNAUTHORIZED
            );
        }

        const decoded = await decodeJwt(authCookie);

        //! maybe remove this cache as this is used in all authencticated routes where we use balance and it needs to be updated
        // or remove or update this cacke key in websocket listner or something like that whenever user balance or other user data is updated
        // const cachedUser = await Cache.get<User>(`user:${decoded.userId}`);

        // if (cachedUser) {
        //     if (c.req.path.startsWith("/api/v1/admin")) {
        //         if (cachedUser.role !== "ADMIN") {
        //             return middlewareApiError(
        //                 c,
        //                 "Unauthorized. You are not an admin.",
        //                 HTTP_STATUS.UNAUTHORIZED
        //             );
        //         }
        //     }

        //     c.set("user", cachedUser);

        //     return await next();
        // }

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

        if (c.req.path.startsWith("/api/v1/admin")) {
            const allowedRoles = ["ADMIN", "SUB_ADMIN"];

            if (!allowedRoles.includes(user.role)) {
                return middlewareApiError(
                    c,
                    "Unauthorized. You are not an admin.",
                    HTTP_STATUS.UNAUTHORIZED
                );
            }

            if (user.role === "SUB_ADMIN") {
                const subAdminRestrictedRoutes = [
                    "/api/v1/admin/withdraw",
                    "/api/v1/admin/subadmin",
                ];
                if (subAdminRestrictedRoutes.includes(c.req.path)) {
                    return middlewareApiError(
                        c,
                        "Unauthorized. You are not authorized to access this route.",
                        HTTP_STATUS.UNAUTHORIZED
                    );
                }
            }
        }

        c.set("user", user);
        // await Cache.set(`user:${decoded.userId}`, user, 60);

        await next();
    } catch (error) {
        logger.error(error);
        const { message, status } = authCatchResponse(error);
        return middlewareApiError(c, message, status);
    }
};
