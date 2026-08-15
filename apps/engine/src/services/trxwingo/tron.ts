/**
 * Tron block client for TRX WinGo result generation.
 *
 * Prefer the **chain tip** (newest block), not Tronscan's solidified
 * `/block/latest` which often lags ~15–20 blocks (~1 minute).
 *
 * Rate-limit safe:
 * - short TTL cache (shared across durations in one tick)
 * - single-flight so concurrent draws don't stampede
 * - 429 backs off; fall back to Trongrid tip when Tronscan is suspended
 */

export interface LatestBlock {
    number: number;
    /** Block hash (Tronscan `hash` / Trongrid `blockID`) */
    hash: string;
    timestamp: number;
    confirmed?: boolean;
}

const DEFAULT_TRONSCAN = "https://apilist.tronscanapi.com/api";
const DEFAULT_TRONGRID = "https://api.trongrid.io";

/** Keep tip fresh — block time ~3s; draws need near-real-time hash. */
const LATEST_TTL_MS = Number(process.env.TRONSCAN_LATEST_TTL_MS ?? "2000");

let latestCache: { at: number; block: LatestBlock } | null = null;
let latestInflight: Promise<LatestBlock> | null = null;
/** Don't hit Tronscan until this timestamp after a 429 */
let rateLimitedUntil = 0;

function tronscanBase(): string {
    return process.env.TRONSCAN_API_BASE?.replace(/\/$/, "") || DEFAULT_TRONSCAN;
}

function trongridBase(): string {
    return process.env.TRONGRID_API_BASE?.replace(/\/$/, "") || DEFAULT_TRONGRID;
}

function tronscanHeaders(): Record<string, string> {
    const h: Record<string, string> = {
        Accept: "application/json",
    };
    const key = process.env.TRONSCAN_API_KEY || process.env.TRON_PRO_API_KEY;
    if (key) {
        h["TRON-PRO-API-KEY"] = key;
    }
    return h;
}

function trongridHeaders(): Record<string, string> {
    const h: Record<string, string> = {
        Accept: "application/json",
    };
    const key = process.env.TRONGRID_API_KEY || process.env.TRON_PRO_API_KEY;
    if (key) {
        h["TRON-PRO-API-KEY"] = key;
    }
    return h;
}

async function fetchJson(
    url: string,
    hdrs: Record<string, string>
): Promise<any> {
    const response = await fetch(url, {
        method: "GET",
        headers: hdrs,
    });
    if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const waitMs =
            Number.isFinite(retryAfter) && retryAfter > 0
                ? retryAfter * 1000
                : Number(process.env.TRONSCAN_429_BACKOFF_MS ?? "15000");
        rateLimitedUntil = Date.now() + waitMs;
        throw new Error(
            `Tron API error: 429 Too Many Requests (${url}) backoff=${waitMs}ms`
        );
    }
    if (!response.ok) {
        throw new Error(
            `Tron API error: ${response.status} ${response.statusText} (${url})`
        );
    }
    return response.json();
}

function normalizeBlock(raw: any): LatestBlock {
    if (!raw || (raw.number == null && raw.blockNumber == null)) {
        throw new Error("Tron API returned incomplete block payload");
    }
    const number = Number(raw.number ?? raw.blockNumber);
    const hash = String(raw.hash ?? raw.blockID ?? raw.blockHash ?? "");
    const timestamp = Number(raw.timestamp ?? raw.block_timestamp ?? 0);
    if (!Number.isFinite(number) || !hash) {
        throw new Error("Tron block missing number or hash");
    }
    return {
        number,
        hash,
        timestamp,
        confirmed: raw.confirmed === true || raw.confirmed === undefined,
    };
}

/** Normalize Trongrid wallet/getnowblock response. */
function normalizeTrongridNow(raw: any): LatestBlock {
    const header = raw?.block_header?.raw_data;
    if (!header || header.number == null || !raw.blockID) {
        throw new Error("Trongrid getnowblock incomplete payload");
    }
    return {
        number: Number(header.number),
        hash: String(raw.blockID),
        timestamp: Number(header.timestamp ?? 0),
        confirmed: false,
    };
}

/**
 * Newest tip from Tronscan block list (sort by number desc).
 * Avoids solidified `/block/latest` which can lag ~1 minute.
 */
async function fetchTronscanTip(): Promise<LatestBlock> {
    if (Date.now() < rateLimitedUntil) {
        throw new Error(
            `Tronscan rate-limited until ${new Date(rateLimitedUntil).toISOString()}`
        );
    }
    const base = tronscanBase();
    // sort=-number → newest height first; limit=1 is the tip
    const data = await fetchJson(
        `${base}/block?sort=-number&start=0&limit=1`,
        tronscanHeaders()
    );
    if (data?.Error || data?.error) {
        throw new Error(
            `Tronscan tip list error: ${data.Error || data.error}`
        );
    }
    const row = Array.isArray(data?.data) ? data.data[0] : null;
    if (row) return normalizeBlock(row);
    // Some deployments return a single object
    if (data?.number != null || data?.blockNumber != null) {
        return normalizeBlock(data);
    }
    throw new Error("Tronscan tip list returned no blocks");
}

/** Fallback: Tronscan /block/latest (often solidified / slightly lagged). */
async function fetchTronscanLatest(): Promise<LatestBlock> {
    if (Date.now() < rateLimitedUntil) {
        throw new Error(
            `Tronscan rate-limited until ${new Date(rateLimitedUntil).toISOString()}`
        );
    }
    const data = await fetchJson(
        `${tronscanBase()}/block/latest`,
        tronscanHeaders()
    );
    if (data?.Error || data?.error) {
        throw new Error(
            `Tronscan latest error: ${data.Error || data.error}`
        );
    }
    return normalizeBlock(data);
}

/** Fallback: Trongrid chain tip (usually real-time). */
async function fetchTrongridTip(): Promise<LatestBlock> {
    const data = await fetchJson(
        `${trongridBase()}/wallet/getnowblock`,
        trongridHeaders()
    );
    return normalizeTrongridNow(data);
}

async function fetchLatestUncached(): Promise<LatestBlock> {
    // Prefer tip list; cascade through latest + Trongrid
    const errors: string[] = [];

    // If Tronscan is in 429 backoff, skip straight to Trongrid
    if (Date.now() < rateLimitedUntil) {
        if (latestCache?.block) {
            // Still try Trongrid for a fresher tip when possible
            try {
                const tip = await fetchTrongridTip();
                latestCache = { at: Date.now(), block: tip };
                return tip;
            } catch {
                return latestCache.block;
            }
        }
        try {
            const tip = await fetchTrongridTip();
            latestCache = { at: Date.now(), block: tip };
            return tip;
        } catch (e) {
            throw new Error(
                `Tron rate-limited and Trongrid failed: ${(e as Error).message}`
            );
        }
    }

    try {
        const tip = await fetchTronscanTip();
        latestCache = { at: Date.now(), block: tip };
        return tip;
    } catch (e) {
        errors.push(`tip: ${(e as Error).message}`);
    }

    try {
        const latest = await fetchTronscanLatest();
        latestCache = { at: Date.now(), block: latest };
        return latest;
    } catch (e) {
        errors.push(`latest: ${(e as Error).message}`);
    }

    try {
        const tip = await fetchTrongridTip();
        latestCache = { at: Date.now(), block: tip };
        return tip;
    } catch (e) {
        errors.push(`trongrid: ${(e as Error).message}`);
    }

    if (latestCache?.block) {
        console.warn(
            "All tip sources failed, using stale cached block:",
            errors.join(" | ")
        );
        return latestCache.block;
    }

    throw new Error(`Failed to fetch Tron tip: ${errors.join(" | ")}`);
}

/**
 * Latest chain tip with cache + single-flight.
 */
export async function getLatestBlock(opts?: {
    /** Force network fetch (still respects 429 backoff via fallbacks) */
    force?: boolean;
}): Promise<LatestBlock> {
    const ttl =
        Number.isFinite(LATEST_TTL_MS) && LATEST_TTL_MS > 0
            ? LATEST_TTL_MS
            : 2000;
    if (
        !opts?.force &&
        latestCache &&
        Date.now() - latestCache.at < ttl
    ) {
        return latestCache.block;
    }

    if (latestInflight) {
        return latestInflight;
    }

    latestInflight = fetchLatestUncached()
        .catch((error) => {
            if (latestCache?.block) {
                console.warn(
                    "Tron fetch failed, using stale cached block:",
                    (error as Error)?.message
                );
                return latestCache.block;
            }
            throw error;
        })
        .finally(() => {
            latestInflight = null;
        });

    return latestInflight;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch tip at/after a wall deadline so Block time shows ~:54 not the prior :51 block.
 *
 * Tron blocks ~3s. Sleeping only until wall drawAt often samples the previous
 * block (timestamp still :51). Poll until tip.timestamp >= minTimestamp.
 */
export async function getTipAtOrAfter(
    minTimestampMs: number,
    opts?: {
        /** Max time to wait for a fresh-enough tip (default 4s) */
        maxWaitMs?: number;
        /** Poll interval (default 350ms) */
        pollMs?: number;
    }
): Promise<LatestBlock> {
    const maxWait = Number(opts?.maxWaitMs ?? process.env.TRX_TIP_WAIT_MAX_MS ?? 4000);
    const poll = Number(opts?.pollMs ?? process.env.TRX_TIP_POLL_MS ?? 350);
    const maxWaitMs =
        Number.isFinite(maxWait) && maxWait > 0 ? Math.min(maxWait, 8000) : 4000;
    const pollMs =
        Number.isFinite(poll) && poll >= 100 ? Math.min(poll, 1500) : 350;

    const deadline = Date.now() + maxWaitMs;
    let best: LatestBlock | null = null;
    let attempts = 0;

    while (true) {
        attempts++;
        const block = await getLatestBlock({ force: true });
        best = block;
        if (block.timestamp >= minTimestampMs) {
            return block;
        }
        if (Date.now() >= deadline) break;
        await sleep(pollMs);
    }

    // Best-effort: return newest tip we saw (may still be slightly early)
    if (best) {
        console.warn(
            `getTipAtOrAfter: tip still before minTs after ${attempts} tries ` +
                `(tipTs=${best.timestamp} minTs=${minTimestampMs} lagMs=${minTimestampMs - best.timestamp})`
        );
        return best;
    }
    return getLatestBlock({ force: true });
}

/**
 * Block by height.
 * GET Tronscan /api/block?num={n}
 */
export async function getBlockByNumber(num: number): Promise<LatestBlock> {
    try {
        if (Date.now() < rateLimitedUntil) {
            throw new Error(
                `Tronscan rate-limited until ${new Date(rateLimitedUntil).toISOString()}`
            );
        }
        const data = await fetchJson(
            `${tronscanBase()}/block?num=${encodeURIComponent(String(num))}`,
            tronscanHeaders()
        );
        if (data?.data && Array.isArray(data.data) && data.data[0]) {
            return normalizeBlock(data.data[0]);
        }
        return normalizeBlock(data);
    } catch (error) {
        console.error(`Error fetching Tronscan block ${num}:`, error);
        throw error;
    }
}
