import Redis from "ioredis";

import Logger from "@bcwin/logger";

const logger = new Logger("redis");

declare global {
    var redis: Redis | undefined;
}

// Function to create and configure the client
const _getRedisClient = () => {
    if (!process.env.REDIS_URL) {
        throw new Error(
            "REDIS_URL is not defined in the environment variables."
        );
    }

    const client = new Redis(process.env.REDIS_URL, {
        retryStrategy: () => {
            return 5000;
        },
    });

    client.on("error", (err) => {
        logger.error("client error", err);
    });

    client.on("ready", () => {
        logger.debug("client ready");
    });

    return client;
};

export const getRedisClient = () => {
    const client = new Redis(process.env.REDIS_URL!, {
        retryStrategy: () => {
            return 5000;
        },
    });

    client.on("error", (err) => {
        if (err.message.includes("ECONNREFUSED")) {
            return;
        }

        logger.error("client error", err);
    });

    return client;
};

const redis = global.redis ?? _getRedisClient();

if (process.env.NODE_ENV !== "production") {
    global.redis = redis;
}

export { redis, type Redis };
