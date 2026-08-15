import { WSContext } from "hono/ws";
import {
    User,
    BetStatus,
    PeriodStatus,
    WingoResultColor,
    WingoResultSize,
} from "@bcwin/db";

import Logger from "@bcwin/logger";
import { Cache, CacheKey, getRedisClient, type Redis } from "@bcwin/cache";

const logger = new Logger("websocket-manager");

type ClientMetadata = {
    id: string;
    instanceId: string;
    connectedAt: string;
};

type Broadcast = {
    type: "broadcast";
    message: string;
};

type Direct = {
    type: "sendToClient";
    clientId: string;
    message: string;
    targetInstanceId: string; // The instance where the client is connected
};

type CrossReplicaMessage = {
    senderInstanceId: string;
    timestamp: number;
} & (Broadcast | Direct);

const ACTIONS = ["subscribe", "unsubscribe"] as const;
type Action = (typeof ACTIONS)[number];

interface PeriodCreationMessage {
    periodId: string;
    periodNumber: string;
    durationSeconds: number;
    startTime: Date;
    endTime: Date;
    status: PeriodStatus;
}

interface AdminBetMessage {
    betId: string;
    userId: string;
    periodId: string;
    periodNumber: string;
    betAmount: number;
    betStatus: BetStatus;
}
interface BroadcastMessageMap {
    "wingo-period-creation": PeriodCreationMessage;
    "wingo-results": {
        periodId: string;
        periodNumber: string;
        durationSeconds: number;
        startTime: Date;
        endTime: Date;
        number: number;
        color: WingoResultColor;
        size: WingoResultSize;
    };
    "5d-period-creation": PeriodCreationMessage;
    "5d-results": {
        periodId: string;
        periodNumber: string;
        durationSeconds: number;
        startTime: Date;
        endTime: Date;
        resultNumber: string;
        resultDigitA: number;
        resultDigitB: number;
        resultDigitC: number;
        resultDigitD: number;
        resultDigitE: number;
        resultSum: number;
    };
    "k3-period-creation": PeriodCreationMessage;
    "k3-results": {
        periodId: string;
        periodNumber: string;
        durationSeconds: number;
        startTime: Date;
        endTime: Date;
        dice1: number;
        dice2: number;
        dice3: number;
        sum: number;
        isTriple: boolean;
        isDouble: boolean;
        isAllDifferent: boolean;
        isConsecutive: boolean;
        isBig: boolean;
        isSmall: boolean;
        isOdd: boolean;
        isEven: boolean;
    };
    "moto-period-creation": PeriodCreationMessage;
    "moto-results": {
        periodId: string;
        periodNumber: string;
        durationSeconds: number;
        startTime: Date;
        endTime: Date;
        firstPlace: number;
        secondPlace: number;
        thirdPlace: number;
    };
    "trx-wingo-period-creation": PeriodCreationMessage;
    "trx-wingo-results": {
        periodId: string;
        periodNumber: string;
        durationSeconds: number;
        startTime: Date;
        endTime: Date;
        number: number;
        color: WingoResultColor;
        size: WingoResultSize;
        blockNumber: number;
        blockHash: string;
    };
    "admin-wingo-bets": AdminBetMessage;
    "admin-5d-bets": AdminBetMessage;
    "admin-k3-bets": AdminBetMessage;
    "admin-moto-bets": AdminBetMessage;
    "admin-trx-wingo-bets": AdminBetMessage;
}

interface DirectMessageMap {
    "account-balance": {
        balance: number;
    };
    "bet-settlement": {
        status: BetStatus;
        periodId: string;
        betAmount: number;
        contractAmount: number;
        winAmount?: number;
    };
}

type BroadcastMessage = {
    [K in keyof BroadcastMessageMap]: {
        topic: K;
        data: BroadcastMessageMap[K];
    };
}[keyof BroadcastMessageMap];

// type DirectMessage = {
//     [K in keyof DirectMessageMap]: {
//         topic: K;
//         data: DirectMessageMap[K];
//     };
// }[keyof DirectMessageMap];

const TOPICS = [
    "account-balance",
    "bet-settlement",
    "wingo-period-creation",
    "wingo-results",
    "5d-period-creation",
    "5d-results",
    "k3-period-creation",
    "k3-results",
    "moto-period-creation",
    "moto-results",
    "trx-wingo-period-creation",
    "trx-wingo-results",
    "admin-wingo-bets",
    "admin-5d-bets",
    "admin-k3-bets",
    "admin-moto-bets",
    "admin-trx-wingo-bets",
] as const;
type Topic = (typeof TOPICS)[number];

// these require user to be authenticated
const PROTECTED_TOPICS: Topic[] = ["account-balance", "bet-settlement"];
// these require user to be authenticated and have admin role
const ADMIN_PROTECTED_TOPICS: Topic[] = [
    "admin-wingo-bets",
    "admin-5d-bets",
    "admin-k3-bets",
    "admin-moto-bets",
    "admin-trx-wingo-bets",
];

const DIRECT_TOPICS: Topic[] = ["account-balance", "bet-settlement"];

export class WebSocketManager {
    // --- Constants ---
    // private static readonly PUBSUB_CHANNEL = "websocket:channel";
    // private static readonly PUBSUB_CHANNEL = CacheKey.websocketPubsubChannel;
    // private static readonly CLIENT_METADATA_PREFIX = "websocket:client-meta:";
    // private static readonly GLOBAL_CLIENTS_SET_KEY = "websocket:global-clients";
    // private static readonly GLOBAL_CLIENTS_SET_KEY = CacheKey.websocketGlobalClients;
    // private static readonly TOPIC_PREFIX = "websocket:topic:";
    // private static readonly CLIENT_TOPICS_PREFIX = "websocket:client-topics:";
    private static readonly CLIENT_TTL_SECONDS = 3600; // 1 hour

    // --- State ---
    private static readonly INSTANCE_ID =
        process.env.INSTANCE_ID || `instance-${crypto.randomUUID()}`;
    private static clients = new Map<string, WSContext>();
    private static clientAuth = new Map<string, User>();
    private static redisPub: Redis;
    private static redisSub: Redis;
    private static initializationPromise: Promise<void> | null = null;
    private static _isShuttingDown = false; // NEW: The state flag

    /**
     * Public getter to check if a graceful shutdown is in progress.
     */
    public static isShuttingDown(): boolean {
        return this._isShuttingDown;
    }

    /**
     * Initializes the WebSocketManager. This must be called once when the application starts.
     * It sets up the Redis Pub/Sub connection for cross-replica communication.
     * This method is idempotent and safe to call multiple times.
     */
    public static initialize(): Promise<void> {
        if (this.initializationPromise) {
            return this.initializationPromise;
        }

        this.initializationPromise = (async () => {
            this.redisSub = getRedisClient();
            this.redisPub = getRedisClient();

            await this.redisSub.subscribe(CacheKey.websocketPubsubChannel);

            this.redisSub.on("message", (channel, message) => {
                if (channel === CacheKey.websocketPubsubChannel) {
                    this.handleCrossReplicaMessage(message);
                }
            });

            logger.debug(
                "WebSocketManager initialized for cross-replica communication",
                {
                    instanceId: this.INSTANCE_ID,
                }
            );
        })();

        return this.initializationPromise;
    }

    /**
     * Gracefully shuts down the manager's connections.
     */
    public static async shutdown(): Promise<void> {
        if (!this.initializationPromise || this._isShuttingDown) return;

        this._isShuttingDown = true;

        const cleanupPromises: Promise<void>[] = [];

        for (const [id, client] of this.clients.entries()) {
            const cleanupTask = (async () => {
                try {
                    // We no longer need to await here, just start the task.
                    await this.removeClient(id);
                    client.close(
                        1012,
                        "Server is restarting. Please reconnect."
                    );
                } catch (error) {
                    const errorMessage =
                        error instanceof Error ? error.message : String(error);
                    logger.warn(
                        "Error cleaning up client socket during shutdown",
                        { id, error: errorMessage }
                    );
                }
            })();
            cleanupPromises.push(cleanupTask);
        }

        // Wait for all client cleanups to complete.
        await Promise.all(cleanupPromises);
        this.clients.clear();

        // Unsubscribe and close Redis connections
        await this.redisSub.unsubscribe(CacheKey.websocketPubsubChannel);
        await Promise.all([this.redisSub.quit(), this.redisPub.quit()]);
    }

    private static async handleCrossReplicaMessage(rawMessage: string) {
        try {
            const data: CrossReplicaMessage = JSON.parse(rawMessage);

            // Ignore messages sent by this same instance
            if (data.senderInstanceId === this.INSTANCE_ID) {
                return;
            }

            switch (data.type) {
                case "broadcast":
                    this.broadcastToLocalClients(data.message);
                    break;

                case "sendToClient":
                    // Only process if this instance is the target
                    if (data.targetInstanceId === this.INSTANCE_ID) {
                        this.sendToLocalClient(data.clientId, data.message);
                    }
                    break;
            }
        } catch (error) {
            logger.error("Failed to parse or handle cross-replica message", {
                error,
                rawMessage,
            });
        }
    }

    private static sendToLocalClient(id: string, message: string) {
        const client = this.clients.get(id);

        if (client && client.readyState === 1) {
            // 1 === OPEN
            try {
                client.send(message);
            } catch (error) {
                logger.error(
                    "Failed to send message to local client, removing",
                    { id, error }
                );
                // If sending fails, the connection is likely broken. Clean it up.
                this.removeClient(id);
            }
        }
    }

    private static broadcastToLocalClients(message: string) {
        logger.debug(`Broadcasting to ${this.clients.size} local clients`);
        for (const [id, client] of this.clients.entries()) {
            // We can reuse the targeted send logic for robustness
            this.sendToLocalClient(id, message);
        }
    }

    private static async subscribe(clientId: string, topic: string) {
        // Use a pipeline for atomic operations
        const pipeline = Cache.client.pipeline();
        // Add topic to the client's subscription list in Redis
        pipeline.sadd(CacheKey.websocketClientTopics(clientId), topic);
        // Add client to the topic's subscriber list in Redis
        pipeline.sadd(CacheKey.websocketTopic(topic), clientId);
        await pipeline.exec();

        logger.debug("Client subscribed to topic", {
            clientId,
            topic,
        });
    }

    private static async unsubscribe(clientId: string, topic: string) {
        const pipeline = Cache.client.pipeline();
        // Remove topic from client's list in Redis
        pipeline.srem(CacheKey.websocketClientTopics(clientId), topic);
        // Remove client from topic's list in Redis
        pipeline.srem(CacheKey.websocketTopic(topic), clientId);
        await pipeline.exec();

        logger.debug("Client unsubscribed from topic", {
            clientId,
            topic,
        });
    }

    private static async sendErrorToClient(clientId: string, error: string) {
        this.sendToClient(
            clientId,
            JSON.stringify({
                success: false,
                error,
            })
        );
    }

    private static async sendSuccessToClient(clientId: string, data: object) {
        this.sendToClient(
            clientId,
            JSON.stringify({
                success: true,
                data,
            })
        );
    }

    private static async validateIncomingMessage(rawMessage: string) {
        const message = JSON.parse(rawMessage);
        const { action, topic } = message;

        if (!action || !topic)
            throw new Error("Invalid message. action and topic are required.");

        if (!ACTIONS.includes(action))
            throw new Error(
                `Invalid action: ${action}. Valid actions are: ${ACTIONS.join(
                    ", "
                )}`
            );

        if (!TOPICS.includes(topic))
            throw new Error(
                `Invalid topic: ${topic}. Valid topics are: ${TOPICS.join(
                    ", "
                )}`
            );

        return { action, topic } as { action: Action; topic: Topic };
    }

    public static async handleIncomingMessage(
        clientId: string,
        rawMessage: string
    ) {
        // This method's logic does not change, it just calls the methods below.
        try {
            const { action, topic } = await this.validateIncomingMessage(
                rawMessage
            );

            logger.debug("Received message from client", {
                clientId,
                action,
                topic,
            });

            if (action === "subscribe") {
                const user = this.clientAuth.get(clientId);

                // Check protected topics
                if (PROTECTED_TOPICS.includes(topic)) {
                    if (!user) {
                        this.sendErrorToClient(
                            clientId,
                            `Authentication required to subscribe to '${topic}'`
                        );
                        return;
                    }
                }

                // Check admin-only topics
                if (ADMIN_PROTECTED_TOPICS.includes(topic)) {
                    if (!user) {
                        this.sendErrorToClient(
                            clientId,
                            `Authentication required to subscribe to '${topic}'`
                        );
                        return;
                    }

                    if (user.role !== "ADMIN") {
                        this.sendErrorToClient(
                            clientId,
                            `You are not authorized to subscribe to '${topic}'`
                        );
                        return;
                    }
                }
            }

            // If the topic is user-specific (direct topic), we should create a dynamic topic name
            let finalTopic: string = topic;
            if (DIRECT_TOPICS.includes(topic)) {
                const user = this.clientAuth.get(clientId)!; // We know user exists from check above

                // if action is unsubscribe and we do not have userid we do not care
                if (action !== "unsubscribe") {
                    finalTopic = `${topic}:${user.id}`;
                }
            }

            switch (action) {
                case "subscribe":
                    this.subscribe(clientId, finalTopic);
                    this.sendSuccessToClient(clientId, {
                        message: "Subscribed to topic",
                        topic: finalTopic,
                    });
                    break;
                case "unsubscribe":
                    this.unsubscribe(clientId, finalTopic);
                    this.sendSuccessToClient(clientId, {
                        message: "Unsubscribed from topic",
                        topic: finalTopic,
                    });
                    break;
            }
        } catch (error) {
            this.sendErrorToClient(
                clientId,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Publishes a message to all clients subscribed to a specific topic.
     * This is now fully replica-safe.
     */
    // public static async publishToTopic(topic: Topic, data: object) {
    private static async publish(topic: string, data: object) {
        // Get the list of subscribers from Redis, not memory
        const subscribers = await Cache.client.smembers(
            CacheKey.websocketTopic(topic)
        );

        if (!subscribers || subscribers.length === 0) {
            return; // No one is listening
        }

        const message = JSON.stringify({ topic, data });
        logger.debug(
            `Publishing to topic '${topic}' for ${subscribers.length} subscribers found in Redis`
        );

        // Your `sendToClient` logic is already replica-safe, so this works perfectly.
        // It will correctly route the message to the right replica via Redis Pub/Sub.
        for (const clientId of subscribers) {
            await this.sendToClient(clientId, message);
        }
    }

    /**
     * Publishes a message to a topic.
     */
    public static async publishToTopic<T extends keyof BroadcastMessageMap>(
        topic: T,
        data: BroadcastMessageMap[T]
    ) {
        // The existing publishToTopic will now work perfectly with this dynamic topic name
        await this.publish(topic, data);
    }

    /**
     * Publishes a message to a user-specific topic.
     * Example: publishToUser('user-123', 'account-balance', { balance: 100 })
     */
    public static async publishToUser<T extends keyof DirectMessageMap>(
        userId: string,
        topic: T,
        data: DirectMessageMap[T]
    ) {
        const userSpecificTopic = `${topic}:${userId}`;
        // The existing publishToTopic will now work perfectly with this dynamic topic name
        await this.publish(userSpecificTopic, data);
    }

    /**
     * Registers a new client connection with the manager.
     * @param id - The unique identifier for the client.
     * @param ws - The WebSocket context object from Hono.
     */
    public static async addClient(id: string, ws: WSContext, user?: User) {
        this.clients.set(id, ws);

        if (user) {
            this.clientAuth.set(id, user);
        }

        const metadata: ClientMetadata = {
            id,
            instanceId: this.INSTANCE_ID,
            connectedAt: new Date().toISOString(),
        };

        // Use a pipeline for atomic operations
        const pipeline = Cache.client.pipeline();
        pipeline.set(
            // `${this.CLIENT_METADATA_PREFIX}${id}`,
            CacheKey.websocketClientMetadata(id),
            JSON.stringify(metadata),
            "EX",
            this.CLIENT_TTL_SECONDS
        );
        pipeline.sadd(CacheKey.websocketGlobalClients, id);
        await pipeline.exec();

        logger.debug("Client connected", { id, instanceId: this.INSTANCE_ID });
    }

    /**
     * Removes a client connection from the manager.
     * @param id - The unique identifier for the client.
     */
    public static async removeClient(id: string) {
        // 1. Get all topics this client was subscribed to from Redis.
        const topics = await Cache.client.smembers(
            CacheKey.websocketClientTopics(id)
        );

        // 2. Start a pipeline for a single, atomic transaction.
        const pipeline = Cache.client.pipeline();

        // 3. For each topic, remove this client from the topic's subscriber list.
        for (const topic of topics) {
            pipeline.srem(CacheKey.websocketTopic(topic), id);
        }

        // 4. Delete the client's own list of topics.
        if (topics.length > 0) {
            pipeline.del(CacheKey.websocketClientTopics(id));
        }

        this.clients.delete(id);
        this.clientAuth.delete(id);

        // const pipeline = Cache.client.pipeline();
        pipeline.del(CacheKey.websocketClientMetadata(id));
        pipeline.srem(CacheKey.websocketGlobalClients, id);

        await pipeline.exec();

        logger.debug("Client disconnected", {
            id,
            instanceId: this.INSTANCE_ID,
        });
    }

    /**
     * Broadcasts a message to ALL clients connected to ANY replica.
     * @param message - The message string to send.
     */
    // public static async broadcast(message: string) {
    public static async broadcast(data: BroadcastMessage) {
        const message = JSON.stringify(data);
        await this.initialize();
        logger.debug("Broadcasting message globally");

        // 1. Send to local clients immediately
        this.broadcastToLocalClients(message);

        // 2. Publish to Redis for other replicas to handle
        const payload: CrossReplicaMessage = {
            type: "broadcast",
            message,
            senderInstanceId: this.INSTANCE_ID,
            timestamp: Date.now(),
        };
        await this.redisPub.publish(
            CacheKey.websocketPubsubChannel,
            JSON.stringify(payload)
        );
    }

    /**
     * Sends a message to a single client, regardless of which replica they are connected to.
     * @param id - The unique identifier of the target client.
     * @param message - The message string to send.
     * @returns True if the message was successfully sent or queued for delivery, false if the client was not found.
     */
    public static async sendToClient(
        id: string,
        message: string
    ): Promise<boolean> {
        await this.initialize();

        // Fast path: client is on this instance
        const localClient = this.clients.get(id);
        if (localClient && localClient.readyState === 1) {
            this.sendToLocalClient(id, message);
            return true;
        }

        // Slow path: client might be on another instance
        const metadataStr = await Cache.client.get(
            // `${this.CLIENT_METADATA_PREFIX}${id}`
            CacheKey.websocketClientMetadata(id)
        );
        logger.debug("metadataStr", { metadataStr });
        if (!metadataStr) {
            logger.warn(
                "Attempted to send message to a client that does not exist",
                { id }
            );
            return false;
        }

        const metadata = JSON.parse(metadataStr) as ClientMetadata;
        const payload: CrossReplicaMessage = {
            type: "sendToClient",
            clientId: id,
            message,
            targetInstanceId: metadata.instanceId,
            senderInstanceId: this.INSTANCE_ID,
            timestamp: Date.now(),
        };

        await this.redisPub.publish(
            CacheKey.websocketPubsubChannel,
            JSON.stringify(payload)
        );
        return true;
    }

    /**
     * Gets the total number of connected clients across all replicas.
     */
    public static async getTotalClientCount(): Promise<number> {
        return Cache.client.scard(CacheKey.websocketGlobalClients);
    }

    /**
     * Gets the IDs of all connected clients across all replicas.
     */
    public static async getAllClientIds(): Promise<string[]> {
        return Cache.client.smembers(CacheKey.websocketGlobalClients);
    }

    /**
     * Checks if a client is connected to any replica.
     * @param id - The unique identifier of the client.
     */
    public static async isClientConnected(id: string): Promise<boolean> {
        return (
            (await Cache.client.sismember(
                CacheKey.websocketGlobalClients,
                id
            )) === 1
        );
    }
}
