import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";

import Logger from "@bcwin/logger";
import { registerRoutes } from "../../apps/api/src/registerRoutes";
import { AUTH_COOKIE_NAME } from "../../apps/api/src/lib/auth";
import { zodErrorHook } from "../../apps/api/src/lib/utils";

let appPromise: Promise<OpenAPIHono> | null = null;

/** Shared Hono app (routes only — no Bun.serve). */
export async function getTestApp(): Promise<OpenAPIHono> {
    if (!appPromise) {
        appPromise = (async () => {
            const app = new OpenAPIHono({ defaultHook: zodErrorHook });
            app.use(
                cors({
                    origin: "*",
                    credentials: true,
                    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
                    allowHeaders: ["Content-Type", "Authorization", "Cookie"],
                })
            );
            await registerRoutes(app, new Logger("test-api"));
            return app;
        })();
    }
    return appPromise;
}

export type ApiOpts = {
    cookie?: string;
    json?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
    headers?: Record<string, string>;
};

function buildUrl(path: string, query?: ApiOpts["query"]): string {
    if (!query) return path;
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
        if (v === undefined) continue;
        sp.set(k, String(v));
    }
    const q = sp.toString();
    return q ? `${path}?${q}` : path;
}

export async function api(
    method: string,
    path: string,
    opts: ApiOpts = {}
): Promise<{ status: number; json: any; headers: Headers; text: string }> {
    const app = await getTestApp();
    const headers = new Headers(opts.headers);
    if (opts.cookie) {
        headers.set("Cookie", `${AUTH_COOKIE_NAME}=${opts.cookie}`);
    }
    let body: string | undefined;
    if (opts.json !== undefined) {
        headers.set("Content-Type", "application/json");
        body = JSON.stringify(opts.json);
    }

    const res = await app.request(buildUrl(path, opts.query), {
        method,
        headers,
        body,
    });

    const text = await res.text();
    let json: any = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = null;
    }

    return { status: res.status, json, headers: res.headers, text };
}

export const get = (path: string, opts?: ApiOpts) => api("GET", path, opts);
export const post = (path: string, opts?: ApiOpts) => api("POST", path, opts);
export const patch = (path: string, opts?: ApiOpts) => api("PATCH", path, opts);
export const del = (path: string, opts?: ApiOpts) => api("DELETE", path, opts);
