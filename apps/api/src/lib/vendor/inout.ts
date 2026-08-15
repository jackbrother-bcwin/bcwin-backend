import * as crypto from "crypto";

import { HTTP_STATUS, HttpStatusCode } from "../http";
import { prisma } from "@bcwin/db";
import * as Config from "@bcwin/config";
import Logger from "@bcwin/logger";

const logger = new Logger("inout");

interface InoutGamesResponse {
    gameMode: string,
    title: string,
    description: string,
    iconsUrls: {
        url: string,
        [key: string]: unknown;
    },
    category: string,
    multiplayer: boolean,
    rtp: string
    bonusTypes: string[]
}

export enum ErrorCodes {
    OK = "OK",

    // Retryable
    TEMPORARY_ERROR = "TEMPORARY_ERROR",

    // Fatal
    INVALID_TOKEN = "INVALID_TOKEN",
    ACCOUNT_LOCKED = "ACCOUNT_LOCKED",
    ACCOUNT_INVALID = "ACCOUNT_INVALID",

    // Final
    UNKNOWN_ERROR = "UNKNOWN_ERROR",
    GAME_DISABLED = "GAME_DISABLED",
    INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS",
    CHECKS_FAIL = "CHECKS_FAIL",
    DEBIT_TRANSACTION_NOT_FOUND = "DEBIT_TRANSACTION_NOT_FOUND",
}

// class InoutError extends Error {
//     statusCode: HttpStatusCode;

//     constructor(
//         message: string,
//         statusCode: HttpStatusCode = HTTP_STATUS.SERVICE_UNAVAILABLE
//     ) {
//         super(message);

//         if (Error.captureStackTrace) {
//             Error.captureStackTrace(this, InoutError);
//         }

//         this.name = this.constructor.name;
//         this.statusCode = statusCode;
//     }
// }

class InoutError extends Error {
    statusCode: HttpStatusCode;
    details?: unknown;

    constructor(
        message: string,
        details?: unknown,
        statusCode: HttpStatusCode = HTTP_STATUS.SERVICE_UNAVAILABLE,
    ) {
        super(message);
        this.statusCode = statusCode;
        this.details = details;
    }
}

class Inout {
    private static readonly baseUrl = "https://api.inout.games/api/"
    private static readonly secretKey = Config.env.INOUT_SECRET_KEY

    static readonly operatorId = Config.env.INOUT_OPERATOR_ID
    static readonly currency = "INR"

    private static async request(endpoint: string, justReturnUrl = false) {
        const url = new URL(endpoint, Inout.baseUrl);
        url.searchParams.set("operatorId", Inout.operatorId);

        logger.debug("url", url)

        if (justReturnUrl) {
            return url.toString()
        }

        try {
            return await fetch(url);
        } catch (error) {
            throw new InoutError(
                "Failed to make request to Inout",
                HTTP_STATUS.SERVICE_UNAVAILABLE
            );
        }
    }

    static async launch(gameMode: string, userId: string) {
        const opId = String(Inout.operatorId ?? "").trim();
        // Placeholder env values produce Inout 400 (as seen with operatorId=dummy)
        if (
            !opId ||
            /^(dummy|test|placeholder|changeme|xxx)$/i.test(opId)
        ) {
            logger.error(
                "INOUT_OPERATOR_ID is missing or still a placeholder (e.g. dummy). " +
                    "Set the real operator id from Inout dashboard in backend .env"
            );
            return {
                success: false,
                error:
                    "Third-party games are not configured (invalid operator id). Contact support.",
            };
        }

        const game = await prisma.inoutGame.findUnique({
            where: { gameMode },
            select: { gameMode: true },
        });

        if (!game) {
            return {
                success: false,
                error: "Game not found. Please provide valid game mode",
            };
        }

        const url = (await Inout.request(
            `launch?gameMode=${gameMode}&authToken=${userId}&currency=${Inout.currency}&lang=en&userCountryCode=IN`,
            true
        )) as string;

        return {
            success: true,
            data: url,
        };
    }

    static async isRequestValid(payload: string, receivedSignature: string) {
        let textToSign = payload;
        try {
            textToSign = JSON.stringify(JSON.parse(payload));
        } catch {
            // fallback to original payload
        }

        const calculatedSignature = crypto.createHmac("sha256", Inout.secretKey)
            .update(textToSign, "utf8")
            .digest("hex");

        return receivedSignature.length === calculatedSignature.length &&
            crypto.timingSafeEqual(
                Buffer.from(receivedSignature, "hex"),
                Buffer.from(calculatedSignature, "hex")
            );
    }

    static async getGames() {
        const response = await Inout.request("gameModesList") as Response;

        if (!response.ok) {
            const error = await response.json()

            throw new InoutError(
                `Failed to get games:`,
                {
                    apiError: error,
                    status: response.status,
                    statusText: response.statusText
                }
            );
        }

        const data = (await response.json()) as InoutGamesResponse[];

        const games = data.map((game) => ({
            ...game,
            icon: game.iconsUrls.url,
            rtp: Number(game.rtp),
        }))

        // Use raw SQL for optimal bulk upsert performance
        // Note: For existing games, we preserve their type (don't overwrite with OTHER)
        await prisma.$executeRaw`
            INSERT INTO "InoutGame" (
                id,
                title,
                "gameMode",
                description,
                category,
                icon,
                multiplayer,
                rtp,
                "bonusTypes",
                "createdAt",
                "updatedAt"
            )
            SELECT
                gen_random_uuid(),
                v.title,
                v."gameMode",
                v.description,
                v.category,
                v.icon,
                v.multiplayer,
                v.rtp,
                v."bonusTypes",
                NOW(),
                NOW()
            FROM jsonb_to_recordset(${JSON.stringify(games)}::jsonb) AS v(
                title text,
                "gameMode" text,
                description text,
                category text,
                icon text,
                multiplayer boolean,
                rtp float8,
                "bonusTypes" jsonb
            )
            ON CONFLICT ("gameMode") DO UPDATE SET
                title = EXCLUDED.title,
                description = EXCLUDED.description,
                category = EXCLUDED.category,
                icon = EXCLUDED.icon,
                multiplayer = EXCLUDED.multiplayer,
                rtp = EXCLUDED.rtp,
                "bonusTypes" = EXCLUDED."bonusTypes",
                "updatedAt" = NOW();
        `;

        logger.info(`Upserted ${games.length} Inout games`);
    }
}

export default Inout