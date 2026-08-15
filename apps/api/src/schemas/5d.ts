import { z } from "@hono/zod-openapi";
import { page, limit } from "./commission";

export const fiveDPeriodResponseSchema = z.object({
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
    resultNumber: z.string().length(5).nullable().openapi({
        description:
            "5-digit result number (00000-99999), null if not resolved",
        example: "12345",
    }),
    resultDigitA: z.number().min(0).max(9).nullable().openapi({
        description: "First digit (A), null if not resolved",
        example: 1,
    }),
    resultDigitB: z.number().min(0).max(9).nullable().openapi({
        description: "Second digit (B), null if not resolved",
        example: 2,
    }),
    resultDigitC: z.number().min(0).max(9).nullable().openapi({
        description: "Third digit (C), null if not resolved",
        example: 3,
    }),
    resultDigitD: z.number().min(0).max(9).nullable().openapi({
        description: "Fourth digit (D), null if not resolved",
        example: 4,
    }),
    resultDigitE: z.number().min(0).max(9).nullable().openapi({
        description: "Fifth digit (E), null if not resolved",
        example: 5,
    }),
    resultSum: z.number().min(0).max(45).nullable().openapi({
        description: "Sum of all digits (0-45), null if not resolved",
        example: 15,
    }),
    status: z.enum(["ACTIVE", "ENDED", "RESOLVED"]).openapi({
        description: "Period status",
        example: "ACTIVE",
    }),
});

export const fiveDPeriodsRequestSchema = z.object({
    duration: z.coerce.number().optional().openapi({
        description: "Filter by duration in seconds (30, 60, 180, 300)",
        example: 60,
    }),
    page,
    limit,
});

export const place5DBetRequestSchema = z.object({
    periodId: z.uuid().openapi({
        description: "Period ID to bet on",
        example: "147f8c93-b8c2-4435-8534-9ac4ad282ca5",
    }),
    betCategory: z.enum(["POSITION", "SUM"]).openapi({
        description: "Bet category - position-based or sum-based",
        example: "POSITION",
    }),
    betType: z
        .enum(["EXACT_NUMBER", "LOW", "HIGH", "ODD", "EVEN", "SUM_EXACT"])
        .openapi({
            description: "Type of bet",
            example: "EXACT_NUMBER",
        }),
    position: z.enum(["A", "B", "C", "D", "E"]).optional().openapi({
        description:
            "Position for POSITION category bets (A=first digit, B=second, etc.)",
        example: "A",
    }),
    betChoice: z.string().openapi({
        description:
            "Bet choice - specific number (0-9), LOW/HIGH, ODD/EVEN, or sum value (0-45)",
        example: "5",
    }),
    betAmount: z.number().min(1).openapi({
        description: "Bet amount",
        example: 100,
    }),
});

export const fiveDBetResponseSchema = z.object({
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
    betCategory: z.enum(["POSITION", "SUM"]).openapi({
        description: "Bet category",
        example: "POSITION",
    }),
    betType: z
        .enum(["EXACT_NUMBER", "LOW", "HIGH", "ODD", "EVEN", "SUM_EXACT"])
        .openapi({
            description: "Type of bet",
            example: "EXACT_NUMBER",
        }),
    position: z.enum(["A", "B", "C", "D", "E"]).nullable().openapi({
        description: "Position for position bets, null for sum bets",
        example: "A",
    }),
    betChoice: z.string().openapi({
        description: "Bet choice",
        example: "5",
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
                example: 882,
            }),
            multiplier: z.number().nullable().openapi({
                description: "Applied multiplier",
                example: 9.0,
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

export const user5DBetsRequestSchema = z.object({
    periodId: z.uuid().optional().openapi({
        description: "Filter by specific period ID",
        example: "147f8c93-b8c2-4435-8534-9ac4ad282ca5",
    }),
    duration: z.coerce.number().optional().openapi({
        description: "Filter by duration in seconds",
        example: 60,
    }),
    betCategory: z.enum(["POSITION", "SUM"]).optional().openapi({
        description: "Filter by bet category",
        example: "POSITION",
    }),
    position: z.enum(["A", "B", "C", "D", "E"]).optional().openapi({
        description: "Filter by position (only for POSITION category)",
        example: "A",
    }),
    limit: z.coerce.number().min(1).max(100).optional().default(20).openapi({
        description: "Number of bets to fetch",
        example: 20,
    }),
    page,
});

export const fiveDResultsRequestSchema = z.object({
    duration: z.coerce.number().optional().openapi({
        description: "Filter by duration in seconds (30, 60, 180, 300)",
        example: 60,
    }),
    page,
    limit,
});

export const fiveDResultResponseSchema = z.object({
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
    resultNumber: z.string().length(5).openapi({
        description: "5-digit result number",
        example: "12345",
    }),
    resultDigitA: z.number().min(0).max(9).openapi({
        description: "First digit (A)",
        example: 1,
    }),
    resultDigitB: z.number().min(0).max(9).openapi({
        description: "Second digit (B)",
        example: 2,
    }),
    resultDigitC: z.number().min(0).max(9).openapi({
        description: "Third digit (C)",
        example: 3,
    }),
    resultDigitD: z.number().min(0).max(9).openapi({
        description: "Fourth digit (D)",
        example: 4,
    }),
    resultDigitE: z.number().min(0).max(9).openapi({
        description: "Fifth digit (E)",
        example: 5,
    }),
    resultSum: z.number().min(0).max(45).openapi({
        description: "Sum of all digits",
        example: 15,
    }),
    userBets: z
        .array(
            z.object({
                id: z.uuid(),
                betAmount: z.number(),
                betCategory: z.enum(["POSITION", "SUM"]),
                betType: z.enum([
                    "EXACT_NUMBER",
                    "LOW",
                    "HIGH",
                    "ODD",
                    "EVEN",
                    "SUM_EXACT",
                ]),
                position: z.enum(["A", "B", "C", "D", "E"]).nullable(),
                betChoice: z.string(),
                isWin: z.boolean(),
                winAmount: z.number(),
                multiplier: z.number().nullable(),
            })
        )
        .nullable()
        .openapi({
            description: "User's bets for this period, null if no bets placed",
        }),
});

export const fiveDStatsResponseSchema = z.object({
    activePeriods: z.array(fiveDPeriodResponseSchema).openapi({
        description: "Currently active periods for all durations",
    }),
    recentResults: z.array(fiveDResultResponseSchema).openapi({
        description: "Recent resolved periods with results",
    }),
    userStats: z
        .object({
            totalBets: z.number().openapi({
                description: "Total number of bets placed by user",
                example: 25,
            }),
            totalWinAmount: z.number().openapi({
                description: "Total amount won by user",
                example: 2450.5,
            }),
            winRate: z.number().openapi({
                description: "Win rate percentage",
                example: 32.5,
            }),
        })
        .nullable()
        .openapi({
            description: "User statistics, null if user not authenticated",
        }),
});
