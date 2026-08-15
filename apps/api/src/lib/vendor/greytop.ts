// import * as crypto from "crypto";

// import { HTTP_STATUS, HttpStatusCode } from "../http";
// import { GreytopGameType, prisma } from "@bcwin/db";
// import * as Config from "@bcwin/config";
// import Logger from "@bcwin/logger";

// const logger = new Logger("greytop");

// class GreytopError extends Error {
//     statusCode: HttpStatusCode;

//     constructor(
//         message: string,
//         statusCode: HttpStatusCode = HTTP_STATUS.SERVICE_UNAVAILABLE
//     ) {
//         super(message);

//         if (Error.captureStackTrace) {
//             Error.captureStackTrace(this, GreytopError);
//         }

//         this.name = this.constructor.name;
//         this.statusCode = statusCode;
//     }
// }

// interface Payload {
//     serial_number: string;
//     currency_code: string;
//     game_uid: string;
//     member_account: string;
//     win_amount: string;
//     bet_amount: string;
//     timestamp: string;
//     game_round: string;
// }

// interface GreytopGamesResponse {
//     data: {
//         providerName: string;
//         providerCode: string;
//         games: { name: string; uid: string }[];
//     }[];
// }

// type NormalizedPayload = Omit<Payload, "win_amount" | "bet_amount"> & {
//     win_amount: number;
//     bet_amount: number;
// };

// export type LaunchResponse =
//     | {
//           success: false;
//           error: string;
//       }
//     | {
//           success: true;
//           data: {
//               status: number;
//               data: {
//                   code: number;
//                   message: string;
//                   payload: {
//                       game_launch_url: string;
//                   };
//               };
//           };
//       };

// class Greytop {
//     private static readonly baseUrl = Config.env.GREYTOP_BASE_URL;
//     private static readonly apiKey = Config.env.GREYTOP_API_KEY;
//     private static readonly aesKey = Config.env.GREYTOP_AES_KEY;
//     private static readonly MEMBER_ACCOUNT_PREFIX =
//         Config.env.GREYTOP_MEMBER_ACCOUNT_PREFIX;

//     private static async request(endpoint: string, body: any) {
//         try {
//             return await fetch(`${Greytop.baseUrl}${endpoint}`, {
//                 method: "POST",
//                 body: JSON.stringify(body),
//                 headers: {
//                     "x-api-key": Greytop.apiKey,
//                     "Content-Type": "application/json",
//                 },
//             });
//         } catch (error) {
//             throw new GreytopError(
//                 "Failed to make request to greytop",
//                 HTTP_STATUS.SERVICE_UNAVAILABLE
//             );
//         }
//     }

//     static async launch(
//         memberAccount: string,
//         uid: string,
//         balance: number
//     ): Promise<LaunchResponse> {
//         // Fetch game from database to get provider code
//         const game = await prisma.greytopGame.findUnique({
//             where: { uid },
//         });

//         if (!game) {
//             return {
//                 success: false,
//                 error: "Game not found. Please provide valid UID",
//             };
//         }

//         const response = await Greytop.request("/api/greytop/Launch", {
//             member_account: memberAccount,
//             game_uid: uid,
//             credit_amount: balance.toString(),
//             providerCode: game.providerCode,
//             home_url: Config.env.DOMAIN,
//             callback_url: Config.env.GREYTOP_CALLBACK_URL,
//         });

//         if (!response.ok) {
//             const error = await response.json();
//             throw new GreytopError(
//                 `Failed to launch game: ${error}:statusText:${response.statusText}:status:${response.status}`
//             );
//         }

//         const data = (await response.json()) as {
//             status: number;
//             data: {
//                 code: number;
//                 message: string;
//                 payload: {
//                     game_launch_url: string;
//                 };
//             };
//         };

//         return {
//             success: true,
//             data,
//         };
//     }

//     static async getGameNameAndType(uid: string) {
//         const game = await prisma.greytopGame.findUnique({
//             where: { uid },
//             select: { name: true, type: true },
//         });

//         return {
//             name: game?.name ?? "UNKNOWN",
//             type: (game?.type as GreytopGameType[]) ?? ["OTHER"],
//         };
//     }

//     static decrypt(payload: string) {
//         try {
//             const key = Buffer.from(Greytop.aesKey, "utf8");

//             let algo = "aes-256-ecb";
//             if (key.length === 16) algo = "aes-128-ecb";
//             else if (key.length === 24) algo = "aes-192-ecb";
//             else if (key.length !== 32) {
//                 throw new Error(
//                     `Invalid key length: ${key.length} bytes. AES-ECB requires 16, 24, or 32 bytes.`
//                 );
//             }

//             const decipher = crypto.createDecipheriv(algo, key, null);

//             decipher.setAutoPadding(true);

//             let decrypted = decipher.update(payload, "base64", "utf8");
//             decrypted += decipher.final("utf8");

//             const data = JSON.parse(decrypted) as Payload;

//             logger.debug("GREYTOP_CALLBACK_DECRYPTED", data);

//             return {
//                 ...data,
//                 win_amount: Number(data.win_amount),
//                 bet_amount: Number(data.bet_amount),
//                 member_account: data.member_account.replace(
//                     Greytop.MEMBER_ACCOUNT_PREFIX,
//                     ""
//                 ),
//             } as NormalizedPayload;
//         } catch (e: any) {
//             throw new GreytopError(
//                 `Decryption failed: ${e.message}`,
//                 HTTP_STATUS.INTERNAL_SERVER_ERROR
//             );
//         }
//     }

//     static async getGames() {
//         const response = await Greytop.request("/api/greytop/get-game", {});

//         if (!response.ok) {
//             const error = await response.json();
//             throw new GreytopError(
//                 `Failed to get games: ${error}:statusText:${response.statusText}:status:${response.status}`
//             );
//         }

//         const data = ((await response.json()) as GreytopGamesResponse).data;

//         // Flatten games with provider info
//         // New games default to OTHER type; seeded games from PDF have correct types
//         const allGames = data.flatMap((provider) =>
//             provider.games.map((game) => ({
//                 name: game.name,
//                 uid: game.uid,
//                 providerName: provider.providerName,
//                 providerCode: provider.providerCode,
//                 type: ["OTHER"],
//             }))
//         );

//         // Deduplicate by uid (keep last occurrence)
//         const gamesMap = new Map(allGames.map((game) => [game.uid, game]));
//         const games = Array.from(gamesMap.values());

//         logger.info(
//             `Found ${allGames.length} games, ${games.length} unique after deduplication`
//         );

//         // Use raw SQL for optimal bulk upsert performance
//         // Note: For existing games, we preserve their type (don't overwrite with OTHER)
//         await prisma.$executeRaw`
//             INSERT INTO "GreytopGame" (id, name, uid, "providerName", "providerCode", type, "createdAt", "updatedAt")
//             SELECT 
//                 gen_random_uuid(),
//                 v.name,
//                 v.uid,
//                 v."providerName",
//                 v."providerCode",
//                 v.type::text[]::"GreytopGameType"[],
//                 NOW(),
//                 NOW()
//             FROM json_to_recordset(${JSON.stringify(games)}::json) AS v(
//                 name text,
//                 uid text,
//                 "providerName" text,
//                 "providerCode" text,
//                 type text[]
//             )
//             ON CONFLICT (uid) DO UPDATE SET
//                 name = EXCLUDED.name,
//                 "providerName" = EXCLUDED."providerName",
//                 "providerCode" = EXCLUDED."providerCode",
//                 "updatedAt" = NOW()
//         `;

//         logger.info(`Upserted ${games.length} Greytop games`);
//     }
// }

// export default Greytop;
