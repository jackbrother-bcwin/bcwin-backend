import { describe, expect, mock, test } from "bun:test";
import { Hono, type Context } from "hono";

// Run this isolated middleware suite without database or Redis connections.
let user = { id: "test-user", role: "USER", isBanned: false };
mock.module("@bcwin/db", () => ({
    prisma: { user: { findUnique: async () => user } },
}));
mock.module("../apps/api/src/lib/utils", () => ({
    middlewareApiError: (c: Context, error: string, status: 401) =>
        c.json({ success: false, error }, status),
}));
process.env.JWT_SECRET = "middleware-ban-test-secret";
const { authMiddleware } = await import("../apps/api/src/middleware/auth");
const { SignJWT } = await import("jose");
const token = await new SignJWT({ userId: user.id, role: "USER" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));

describe("authenticated requests after a ban", () => {
    test("the same JWT works before ban, is blocked after ban, and works after unban", async () => {
        let actions = 0;
        const app = new Hono();
        app.use(authMiddleware);
        app.post("/api/v1/bet", (c) => {
            actions++;
            return c.json({ success: true });
        });
        const request = () => app.request("/api/v1/bet", {
            method: "POST",
            headers: { Cookie: `auth-token=${token}` },
        });

        expect((await request()).status).toBe(200);
        user = { ...user, isBanned: true };
        const rejected = await request();
        expect(rejected.status).toBe(403);
        expect(await rejected.json()).toEqual({
            success: false,
            error: "Your account is banned",
            code: "ACCOUNT_BANNED",
        });
        expect(rejected.headers.get("set-cookie")).toContain("Max-Age=0");
        expect(actions).toBe(1);

        user = { ...user, isBanned: false };
        expect((await request()).status).toBe(200);
        expect(actions).toBe(2);
        expect((await app.request("/api/v1/bet", { method: "POST" })).status).toBe(401);
        expect(actions).toBe(2);
    });
});
