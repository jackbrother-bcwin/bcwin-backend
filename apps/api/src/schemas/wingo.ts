import { z } from "@hono/zod-openapi";
import { page, limit } from "./commission";

export const wingoPeriodResponseSchema = z.object({
    id: z.uuid().openapi({
        description: "Period ID",
        example: "147f8c93-b8c2-4435-8534-9ac4ad282ca5",
    }),
    periodNumber: z.string().openapi({
        description: "Period number identifier",
        example: "2024010115001",
    }),
    durationSeconds: z.number().openapi({
        description: "Duration in seconds",
        example: 60,
    }),
    startTime: z.iso.datetime().openapi({
        description: "Period start time",
        example: "2024-01-01T15:00:00Z",
    }),
    endTime: z.iso.datetime().openapi({
        description: "Period end time",
        example: "2024-01-01T15:01:00Z",
    }),
    resultNumber: z.number().min(0).max(9).nullable().openapi({
        description: "Result number (0-9), null if not resolved",
        example: 7,
    }),
    resultColor: z.enum(["RED", "GREEN", "VIOLET"]).nullable().openapi({
        description: "Result color, null if not resolved",
        example: "GREEN",
    }),
    // resultColor: z.string().nullable().openapi({
    //     description: "Result color, null if not resolved",
    //     example: "GREEN",
    // }),
    resultSize: z.enum(["BIG", "SMALL"]).nullable().openapi({
        description: "Result size, null if not resolved",
        example: "BIG",
    }),
    status: z.enum(["ACTIVE", "ENDED", "RESOLVED"]).openapi({
        description: "Period status",
        example: "ACTIVE",
    }),
});

export const periodsRequestSchema = z.object({
    duration: z.coerce.number().optional().openapi({
        description: "Filter by duration in seconds (30, 60, 180, 300)",
        example: 60,
    }),
    page,
    limit,
});

export const placeBetRequestSchema = z.object({
    periodId: z.uuid().openapi({
        description: "Period ID to bet on",
        example: "147f8c93-b8c2-4435-8534-9ac4ad282ca5",
    }),
    betType: z.enum(["COLOR", "NUMBER", "SIZE"]).openapi({
        description: "Type of bet",
        example: "COLOR",
    }),
    betChoice: z.string().openapi({
        description:
            "Bet choice (RED/GREEN/VIOLET for COLOR, 0-9 for NUMBER, BIG/SMALL for SIZE)",
        example: "RED",
    }),
    betAmount: z.number().min(1).openapi({
        description: "Bet amount (no upper cap — limited by user balance)",
        example: 100,
    }),
});

export const wingoBetResponseSchema = z.object({
    id: z.uuid().openapi({
        description: "Bet ID",
        example: "147f8c93-b8c2-4435-8534-9ac4ad282ca5",
    }),
    periodId: z.uuid().openapi({
        description: "Period ID",
        example: "147f8c93-b8c2-4435-8534-9ac4ad282ca5",
    }),
    periodNumber: z.string().openapi({
        description: "Period number",
        example: "2024010115001",
    }),
    betAmount: z.number().openapi({
        description: "Original bet amount",
        example: 100,
    }),
    contractAmount: z.number().openapi({
        description: "Contract amount (after service fee)",
        example: 98,
    }),
    betType: z.enum(["COLOR", "NUMBER", "SIZE"]).openapi({
        description: "Type of bet",
        example: "COLOR",
    }),
    betChoice: z.string().openapi({
        description: "Bet choice",
        example: "RED",
    }),
    status: z.enum(["PENDING", "WON", "LOST"]).openapi({
        description: "Bet status",
        example: "PENDING",
    }),
    result: z
        .object({
            isWin: z.boolean().openapi({
                description: "Whether bet won",
                example: true,
            }),
            winAmount: z.number().openapi({
                description: "Win amount",
                example: 196,
            }),
            multiplier: z.number().nullable().openapi({
                description: "Applied multiplier",
                example: 2.0,
            }),
        })
        .nullable()
        .openapi({
            description: "Bet result, null if not resolved",
        }),
    createdAt: z.iso.datetime().openapi({
        description: "Bet creation time",
        example: "2024-01-01T15:00:30Z",
    }),
});

export const userBetsRequestSchema = z.object({
    periodId: z.uuid().optional().openapi({
        description: "Filter by specific period ID",
        example: "147f8c93-b8c2-4435-8534-9ac4ad282ca5",
    }),
    duration: z.coerce.number().optional().openapi({
        description: "Filter by duration in seconds",
        example: 60,
    }),
    limit: z.coerce.number().min(1).max(100).optional().default(20).openapi({
        description: "Number of bets to fetch",
        example: 20,
    }),
    page,
});

export const resultsRequestSchema = z.object({
    duration: z.coerce.number().optional().openapi({
        description: "Filter by duration in seconds (30, 60, 180, 300)",
        example: 60,
    }),
    page,
    limit,
});

export const wingoResultResponseSchema = z.object({
    id: z.uuid().openapi({
        description: "Period ID",
        example: "147f8c93-b8c2-4435-8534-9ac4ad282ca5",
    }),
    periodNumber: z.string().openapi({
        description: "Period number",
        example: "2024010115001",
    }),
    durationSeconds: z.number().openapi({
        description: "Duration in seconds",
        example: 60,
    }),
    startTime: z.iso.datetime().openapi({
        description: "Period start time",
        example: "2024-01-01T15:00:00Z",
    }),
    endTime: z.iso.datetime().openapi({
        description: "Period end time",
        example: "2024-01-01T15:01:00Z",
    }),
    resultNumber: z.number().min(0).max(9).openapi({
        description: "Result number",
        example: 7,
    }),
    resultColor: z.enum(["RED", "GREEN", "VIOLET"]).openapi({
        description: "Result color",
        example: "GREEN",
    }),
    resultSize: z.enum(["BIG", "SMALL"]).openapi({
        description: "Result size",
        example: "BIG",
    }),
    /** TRX WinGo — optional Tron proof (null/omitted for classic WinGo) */
    blockNumber: z.number().nullable().optional().openapi({
        description: "Tron block height",
        example: 84544217,
    }),
    blockHash: z.string().nullable().optional().openapi({
        description: "Tron block hash",
        example: "00000000050a0ad98a405a6ed4021e8c25d26c0cc5c635472da2e48c856637a4",
    }),
    blockTimestamp: z.string().nullable().optional().openapi({
        description: "Tron block timestamp (ms string or ISO)",
        example: "1784302950000",
    }),
    userBet: z
        .object({
            id: z.uuid(),
            betAmount: z.number(),
            betType: z.enum(["COLOR", "NUMBER", "SIZE"]),
            betChoice: z.string(),
            isWin: z.boolean(),
            winAmount: z.number(),
        })
        .nullable()
        .openapi({
            description: "User's bet for this period, null if no bet placed",
        }),
});
