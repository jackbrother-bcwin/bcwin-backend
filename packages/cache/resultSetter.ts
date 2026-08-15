import { prisma } from "@bcwin/db";
import { redis, type Redis } from "./redis";
import Logger from "@bcwin/logger";

const logger = new Logger("result-setter");

type Game = "wingo" | "moto" | "5d" | "k3";

type WingoResult = {
    number: number;
};

type FiveDResult = {
    resultNumber: string;
};

type K3Result = {
    dice1: number;
    dice2: number;
    dice3: number;
};

type MotoResult = {
    firstPlace: number;
    secondPlace: number;
    thirdPlace: number;
};

type GameResultMap = {
    wingo: WingoResult;
    moto: MotoResult;
    "5d": FiveDResult;
    k3: K3Result;
};

export class ResultSetter {
    private static client: Redis = redis;

    private static getKey(game: Game, periodId: string) {
        return `admin:${game}:result:${periodId}`;
    }

    /** Ensure the period exists and is still ACTIVE for this game */
    private static async findActivePeriod(game: Game, periodId: string) {
        switch (game) {
            case "wingo":
                return prisma.wingoPeriod.findUnique({
                    where: { id: periodId, status: "ACTIVE" },
                });
            case "k3":
                return prisma.k3Period.findUnique({
                    where: { id: periodId, status: "ACTIVE" },
                });
            case "5d":
                return prisma.fiveDPeriod.findUnique({
                    where: { id: periodId, status: "ACTIVE" },
                });
            case "moto":
                return prisma.motoPeriod.findUnique({
                    where: { id: periodId, status: "ACTIVE" },
                });
            default:
                return null;
        }
    }

    static async set<G extends Game>(
        game: G,
        periodId: string,
        result: GameResultMap[G]
    ) {
        const key = this.getKey(game, periodId);

        try {
            const period = await this.findActivePeriod(game, periodId);

            if (!period) {
                return {
                    success: false,
                    message: "Period not found or not active",
                };
            }

            await this.client.set(key, JSON.stringify(result), "EX", 60 * 15); // 15 minutes
            logger.debug("Set result", { game, periodId, result });

            return {
                success: true,
                message: "Result set successfully",
            };
        } catch {
            logger.error("Failed to set result", { game, periodId, result });
            return {
                success: false,
                message: "Failed to set result",
            };
        }
    }

    static async get<G extends Game>(
        game: G,
        periodId: string
    ): Promise<GameResultMap[G] | null> {
        const key = this.getKey(game, periodId);
        try {
            const result = await this.client.get(key);
            return result ? (JSON.parse(result) as GameResultMap[G]) : null;
        } catch {
            logger.error("Failed to get result", { game, periodId });
            return null;
        }
    }

    static async del<G extends Game>(game: G, periodId: string) {
        const key = this.getKey(game, periodId);
        try {
            await this.client.del(key);
        } catch {
            logger.error("Failed to delete result", { game, periodId });
        }
    }
}
