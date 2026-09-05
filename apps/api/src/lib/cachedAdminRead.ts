// Coalesce concurrent reads per API process. Completed values live only in Redis,
// so existing cache invalidation still takes effect immediately.
import { Cache } from "@bcwin/cache";

const pending = new Map<string, Promise<unknown>>();

export async function cachedAdminRead<T>(
    key: string,
    ttlSeconds: number,
    compute: () => Promise<T>
): Promise<T> {
    const existing = pending.get(key);
    if (existing) return existing as Promise<T>;
    const work = (async () => {
        const cached = await Cache.get<T>(key);
        if (cached !== null) return cached;
        const result = await compute();
        await Cache.set(key, result, ttlSeconds);
        return result;
    })();
    pending.set(key, work);
    try {
        return await work;
    } finally {
        if (pending.get(key) === work) pending.delete(key);
    }
}
