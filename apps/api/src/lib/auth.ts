import { jwtVerify, SignJWT } from "jose";

import { User } from "@bcwin/db";
import { JwtPayload } from "../types";

export const AUTH_COOKIE_NAME = "auth-token";

/**
 * Production: set AUTH_COOKIE_DOMAIN=.bcwin.club so auth-token is sent to
 * both bcwin.club and api.bcwin.club (needed for authenticated WebSocket topics).
 */
export const authCookieOptions = () => {
    const isProd = process.env.NODE_ENV === "production";
    const domain = process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined;
    return {
        httpOnly: true,
        secure: isProd,
        path: "/",
        sameSite: "lax" as const,
        ...(domain ? { domain } : {}),
    };
};

const JWT_SECRET = (() => {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET environment variable is required");
    return new TextEncoder().encode(secret);
})();

const encodeJwt = async (payload: JwtPayload) => {
    return await new SignJWT(payload)
        .setProtectedHeader({
            alg: "HS256",
        })
        .setExpirationTime("5h")
        .sign(JWT_SECRET);
};

export const generateToken = async (user: User) => {
    const payload: JwtPayload = {
        userId: user.id,
        role: user.role,
    };

    return await encodeJwt(payload);
};

const isJwtPayload = (data: any): data is JwtPayload => {
    return (
        typeof data === "object" &&
        data !== null &&
        typeof data.userId === "string" &&
        typeof data.role === "string"
    );
};

export const decodeJwt = async (token: string) => {
    try {
        const payload = (await jwtVerify(token, JWT_SECRET)).payload;

        if (!isJwtPayload(payload)) {
            throw new Error("Invalid token");
        }

        return payload;
    } catch (error) {
        throw new Error("Invalid token");
    }
};

// export const validateToken = async (token: string) => {
//     try {
//         const payload = await decodeJwt(token)
//         return {
//             valid: true,
//             payload
//         }
//     } catch (error) {
//         return {
//             valid: false,
//             payload: null
//         }
//     }
// }