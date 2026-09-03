// import Redis from "ioredis";
import { redis, type Redis } from "./redis";

import Logger from "@bcwin/logger";

const logger = new Logger("cache");

class CacheTimeoutError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "CacheTimeoutError";
    }
}

export class Cache {
    static client: Redis;
    private static circuitOpenUntil: number = 0; // 0 means the circuit is closed.
    private static readonly CIRCUIT_BREAKER_DURATION_MS = 60_000; // 60 seconds

    private constructor() { }

    static initialize() {
        this.client = redis;

        this.client.on("ready", () => {
            this.circuitOpenUntil = 0;
        });

        logger.debug("Cache initialized");
    }

    private static getClient(): Redis {
        if (!this.client) {
            this.client = redis;
        }

        return this.client;
    }

    private static handleCacheError(error: unknown) {
        if (error instanceof CacheTimeoutError) {
            logger.warn(
                `Circuit breaker opened for ${this.CIRCUIT_BREAKER_DURATION_MS}ms due to cache timeout`
            );
            this.circuitOpenUntil =
                Date.now() + this.CIRCUIT_BREAKER_DURATION_MS;
        }
    }

    static async set<T>(
        key: string,
        value: T,
        ttlSeconds: number
    ): Promise<void> {
        try {
            if (process.env.DISABLE_CACHE || this.circuitOpenUntil > Date.now())
                return;

            const redis = this.getClient();
            const serialized = JSON.stringify(value);

            await withTimeout(redis.set(key, serialized, "EX", ttlSeconds));
        } catch (error) {
            logger.error("Failed to set cache", error);
            this.handleCacheError(error);
        }
    }

    static async get<T>(key: string): Promise<T | null> {
        try {
            if (process.env.DISABLE_CACHE || this.circuitOpenUntil > Date.now())
                return null;

            const redis = this.getClient();
            const data = await withTimeout(redis.get(key));

            if (data) {
                logger.debug("hit", {
                    key,
                });
            } else {
                logger.debug("miss", {
                    key,
                });
            }

            return data ? (JSON.parse(data) as T) : null;
        } catch (error) {
            logger.error("Failed to get cache", error);
            this.handleCacheError(error);

            return null;
        }
    }

    static async hset<T>(
        key: string,
        field: string,
        value: T,
        ttlSeconds: number | null = null
    ): Promise<void> {
        try {
            if (process.env.DISABLE_CACHE || this.circuitOpenUntil > Date.now())
                return;

            const redis = this.getClient();
            const serialized = JSON.stringify(value);

            await withTimeout(redis.hset(key, field, serialized));

            if (ttlSeconds) {
                await withTimeout(redis.expire(key, ttlSeconds));
            }
        } catch (error) {
            logger.error("Failed to hset cache", { key, field, error });
            this.handleCacheError(error);
        }
    }

    static async hget<T>(key: string, field: string): Promise<T | null> {
        try {
            if (process.env.DISABLE_CACHE || this.circuitOpenUntil > Date.now())
                return null;

            const redis = this.getClient();
            const data = await withTimeout(redis.hget(key, field));

            if (data) {
                logger.debug("hash hit", { key, field });
                return JSON.parse(data) as T;
            } else {
                logger.debug("hash miss", { key, field });
                return null;
            }
        } catch (error) {
            logger.error("Failed to hget cache", { key, field, error });
            this.handleCacheError(error);
            return null;
        }
    }

    static async expire(key: string, ttlSeconds: number): Promise<void> {
        try {
            if (process.env.DISABLE_CACHE || this.circuitOpenUntil > Date.now())
                return;

            const redis = this.getClient();
            await withTimeout(redis.expire(key, ttlSeconds), 200);
        } catch (error) {
            logger.error("Failed to set expiry on cache key", { key, error });
            this.handleCacheError(error);
        }
    }

    static async del(key: string): Promise<number> {
        try {
            const redis = this.getClient();
            return await redis.del(key);
        } catch (error) {
            logger.error("Failed to delete cache", error);
            return 0;
        }
    }

    /**
     * Invalidate unified game history (+ optional per-game bet list keys).
     * Call after bet place / settle / rollback so history is fresh without
     * giving up read caching for repeated opens.
     */
    static async invalidateUserGameCaches(
        userId: string,
        ...extraKeys: string[]
    ): Promise<void> {
        try {
            const keys = [CacheKey.gameHistory(userId), ...extraKeys];
            await Promise.all(keys.map((k) => this.del(k)));
        } catch (error) {
            logger.error("Failed to invalidate user game caches", {
                userId,
                error,
            });
        }
    }

    static async disconnect(): Promise<void> {
        if (this.client) {
            await this.client.quit();
        }
    }

    static async ping(): Promise<boolean> {
        try {
            const redis = this.getClient();
            const reply = await withTimeout(redis.ping());

            return reply === "PONG";
        } catch (error) {
            logger.error("Failed to ping Redis", error);
            return false;
        }
    }
}

export class CacheKey {
    // static user = (userId: string) => `user:${userId}`;
    static bank = (userId: string) => `user:${userId}:bank`;

    static fiveDBets = (userId: string) => `user:${userId}:5d-bets`;
    static k3Bets = (userId: string) => `user:${userId}:k3-bets`;
    static motoBets = (userId: string) => `user:${userId}:moto-bets`;
    static wingoBets = (userId: string) => `user:${userId}:wingo-bets`;
    static trxWingoBets = (userId: string) => `user:${userId}:trx-wingo-bets`;
    static inoutBets = (userId: string) => `user:${userId}:inout-bets`;

    // Phase 1: High Priority Cache Keys
    static teamMembers = (userId: string) => `user:${userId}:team-members`;
    static teamOverview = (userId: string) => `user:${userId}:team-overview`;
    static vipStatus = (userId: string) => `user:${userId}:vip-status`;
    static commissionBreakdown = (userId: string) =>
        `user:${userId}:commission-breakdown`;
    static userDeposits = (userId: string) => `user:${userId}:deposits`;
    static userWithdrawals = (userId: string) => `user:${userId}:withdrawals`;
    static dailyCommission = (userId: string) =>
        `user:${userId}:daily-commission`;
    static rebateHistory = (userId: string) => `user:${userId}:rebate-history`;
    static gameHistory = (userId: string) => `user:${userId}:game-history`;
    static vipRewardClaims = (userId: string) => `user:${userId}:vip-reward-claims`;

    // Phase 2: Quick Wins - Config & Historical Data
    static vipRequirements = "config:vip-requirements:v2";
    static commissionRates = "config:commission-rates";

    /** v3: real USER + SUCCESS today recharge/withdraw (ADR-0024) */
    static adminOverview = "admin:overview:v3";
    /** Live dashboard settled rebate and paid salary totals (2-second TTL). */
    static adminDashboardEarnings = "admin:dashboard-earnings:v1";
    static adminGifts = "admin:gifts";
    /** v2: settled team rebate + all credited salary totals. */
    static adminUserStats = (userId: string) => `admin:user-stats:v2:${userId}`;
    static adminWithdrawals = "admin:withdrawals";
    static adminDeposits = "admin:deposits";
    static adminUsers = "admin:users";
    static adminSubAdmins = "admin:subadmins";
    static adminAgents = "admin:agents";
    static adminAgentPerformance = (agentId: string) =>
        `admin:agent-performance:${agentId}`;
    static adminBalanceTransactions = "admin:balance-transactions";
    static illegalBets = "admin:illegal-bets";
    static illegalBetsStatistics = "admin:illegal-bets-statistics:v2";
    static adminIps = "admin:ips";
    static ipStatistics = "admin:ip-statistics";
    static adminProfitLoss = "admin:profit-loss:v2";
    static adminTopPerformance = "admin:top-performance:v2";
    static adminGameHistory = "admin:game-history";
    static adminCommissionHistory = "admin:commission-history";
    static adminActivityBonusHistory = "admin:activity-bonus-history";
    static adminRebateHistory = "admin:rebate-history";
    static adminQueries = "admin:queries";
    static adminNotifications = "admin:notifications";
    static adminSalaryRules = "admin:salary-rules";
    static adminSalaryStats = "admin:salary-stats";
    static userQueries = (userId: string) => `user:${userId}:queries`;
    static userNotifications = "user:notifications";
    static userSalaryHistory = (userId: string) =>
        `user:${userId}:salary-history`;
    static systemConfig = "system:config";
    static inoutGames = "inout:games";

    static websocketPubsubChannel = "websocket:channel";
    static websocketGlobalClients = "websocket:global-clients";
    static websocketTopic = (topic: string) => `websocket:topic:${topic}`;
    static websocketClientTopics = (clientId: string) =>
        `websocket:client-topics:${clientId}`;
    static websocketClientMetadata = (clientId: string) =>
        `websocket:client-metadata:${clientId}`;
}

/**
 * Races a promise against a timeout.
 * @param promise The promise to execute.
 * @param ms The timeout duration in milliseconds.
 * @returns The result of the promise if it resolves within the time limit.
 * @throws Rejects with a timeout error if the promise takes too long.
 */
function withTimeout<T>(promise: Promise<T>, ms: number = 200): Promise<T> {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new CacheTimeoutError(`Operation timed out after ${ms} ms`));
        }, ms);

        promise
            .then((res) => {
                clearTimeout(timeoutId);
                resolve(res);
            })
            .catch((err) => {
                clearTimeout(timeoutId);
                reject(err);
            });
    });
}

Cache.initialize();

export * from "./redis";
export * from "./resultSetter";
