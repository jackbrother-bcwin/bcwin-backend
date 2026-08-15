import { z } from "@hono/zod-openapi";
import { page, limit } from "./commission";

export const motoPeriodResponseSchema = z.object({
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
    firstPlace: z.number().min(1).max(10).nullable().openapi({
        description: "First place bike number (1-10), null if not resolved",
        example: 7,
    }),
    secondPlace: z.number().min(1).max(10).nullable().openapi({
        description: "Second place bike number (1-10), null if not resolved",
        example: 3,
    }),
    thirdPlace: z.number().min(1).max(10).nullable().openapi({
        description: "Third place bike number (1-10), null if not resolved",
        example: 10,
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
    betType: z.enum(["POSITION", "ODD_EVEN", "BIG_SMALL"]).openapi({
        description: "Type of bet",
        example: "POSITION",
    }),
    betChoice: z.string().openapi({
        description:
            "Bet choice (1-10 for POSITION, odd/even for ODD_EVEN, big/small for BIG_SMALL)",
        example: "7",
    }),
    targetPosition: z.enum(["FIRST", "SECOND", "THIRD"]).openapi({
        description: "Which position to bet on",
        example: "FIRST",
    }),
    betAmount: z.number().min(1).openapi({
        description: "Bet amount (no upper cap — limited by user balance)",
        example: 100,
    }),
});

export const motoBetResponseSchema = z.object({
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
    betType: z.enum(["POSITION", "ODD_EVEN", "BIG_SMALL"]).openapi({
        description: "Type of bet",
        example: "POSITION",
    }),
    betChoice: z.string().openapi({
        description: "Bet choice",
        example: "7",
    }),
    targetPosition: z.enum(["FIRST", "SECOND", "THIRD"]).openapi({
        description: "Target position",
        example: "FIRST",
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
                example: 960.4,
            }),
            multiplier: z.number().nullable().openapi({
                description: "Applied multiplier",
                example: 9.8,
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

export const motoResultResponseSchema = z.object({
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
    firstPlace: z.number().min(1).max(10).openapi({
        description: "First place bike number",
        example: 7,
    }),
    secondPlace: z.number().min(1).max(10).openapi({
        description: "Second place bike number",
        example: 3,
    }),
    thirdPlace: z.number().min(1).max(10).openapi({
        description: "Third place bike number",
        example: 10,
    }),
    userBet: z
        .object({
            id: z.uuid(),
            betAmount: z.number(),
            betType: z.enum(["POSITION", "ODD_EVEN", "BIG_SMALL"]),
            betChoice: z.string(),
            targetPosition: z.enum(["FIRST", "SECOND", "THIRD"]),
            isWin: z.boolean(),
            winAmount: z.number(),
        })
        .nullable()
        .openapi({
            description: "User's bet for this period, null if no bet placed",
        }),
});
