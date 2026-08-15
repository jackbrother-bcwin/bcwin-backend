import { Context, Next } from "hono";
import { middlewareApiError } from "@/lib/utils";
import { HTTP_STATUS } from "@/lib/http";

/**
 * Middleware to validate JSON body is present for POST/PUT/PATCH requests
 */
export const validateJsonBody = async (c: Context, next: Next) => {
    const method = c.req.method.toUpperCase();

    // Only check for POST, PUT, PATCH methods
    if (method === "POST" || method === "PUT" || method === "PATCH") {
        const contentType = c.req.header("content-type");

        // Check if content-type is application/json
        if (!contentType || !contentType.includes("application/json")) {
            return middlewareApiError(
                c,
                "Content-Type must be application/json",
                HTTP_STATUS.BAD_REQUEST
            );
        }
    }

    await next();
};
