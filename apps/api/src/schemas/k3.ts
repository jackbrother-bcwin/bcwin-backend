import { z } from "@hono/zod-openapi";
import { page, limit } from "./commission";

export const k3PeriodResponseSchema = z.object({
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
    dice1: z.number().min(1).max(6).nullable().openapi({
        description: "First dice result (1-6), null if not resolved",
        example: 4,
    }),
    dice2: z.number().min(1).max(6).nullable().openapi({
        description: "Second dice result (1-6), null if not resolved",
        example: 2,
    }),
    dice3: z.number().min(1).max(6).nullable().openapi({
        description: "Third dice result (1-6), null if not resolved",
        example: 6,
    }),
    sum: z.number().min(3).max(18).nullable().openapi({
        description: "Sum of all dice (3-18), null if not resolved",
        example: 12,
    }),
    isTriple: z.boolean().nullable().openapi({
        description: "Whether all three dice are same, null if not resolved",
        example: false,
    }),
    isDouble: z.boolean().nullable().openapi({
        description:
            "Whether at least two dice are same (but not triple), null if not resolved",
        example: false,
    }),
    isAllDifferent: z.boolean().nullable().openapi({
        description: "Whether all three dice are unique, null if not resolved",
        example: true,
    }),
    isConsecutive: z.boolean().nullable().openapi({
        description:
            "Whether dice form consecutive sequence, null if not resolved",
        example: false,
    }),
    isBig: z.boolean().nullable().openapi({
        description: "Whether sum is 11-18, null if not resolved",
        example: true,
    }),
    isSmall: z.boolean().nullable().openapi({
        description: "Whether sum is 3-10, null if not resolved",
        example: false,
    }),
    isOdd: z.boolean().nullable().openapi({
        description: "Whether sum is odd, null if not resolved",
        example: false,
    }),
    isEven: z.boolean().nullable().openapi({
        description: "Whether sum is even, null if not resolved",
        example: true,
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
    betType: z
        .enum([
            "SUM",
            "TRIPLE_ANY",
            "TRIPLE_SPECIFIC",
            "DOUBLE_ANY",
            "DOUBLE_SPECIFIC",
            "ALL_DIFFERENT",
            "TWO_NUMBERS",
            "CONSECUTIVE",
            "BIG",
            "SMALL",
            "ODD",
            "EVEN",
        ])
        .openapi({
            description: "Type of bet",
            example: "BIG",
        }),
    betChoice: z.string().openapi({
        description:
            "Bet choice - format depends on bet type (e.g., '12' for SUM, '3' for TRIPLE_SPECIFIC, '4,4,6' for DOUBLE_SPECIFIC, '2,5' for TWO_NUMBERS)",
        example: "12",
    }),
    betAmount: z.number().min(1).openapi({
        description: "Bet amount",
        example: 100,
    }),
});

export const k3BetResponseSchema = z.object({
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
    betType: z
        .enum([
            "SUM",
            "TRIPLE_ANY",
            "TRIPLE_SPECIFIC",
            "DOUBLE_ANY",
            "DOUBLE_SPECIFIC",
            "ALL_DIFFERENT",
            "TWO_NUMBERS",
            "CONSECUTIVE",
            "BIG",
            "SMALL",
            "ODD",
            "EVEN",
        ])
        .openapi({
            description: "Type of bet",
            example: "BIG",
        }),
    betChoice: z.string().openapi({
        description: "Bet choice",
        example: "12",
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
                example: 588,
            }),
            multiplier: z.number().nullable().openapi({
                description: "Applied multiplier",
                example: 6.0,
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

export const k3ResultResponseSchema = z.object({
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
    dice1: z.number().min(1).max(6).openapi({
        description: "First dice result",
        example: 4,
    }),
    dice2: z.number().min(1).max(6).openapi({
        description: "Second dice result",
        example: 2,
    }),
    dice3: z.number().min(1).max(6).openapi({
        description: "Third dice result",
        example: 6,
    }),
    sum: z.number().min(3).max(18).openapi({
        description: "Sum of all dice",
        example: 12,
    }),
    isTriple: z.boolean().openapi({
        description: "Whether all three dice are same",
        example: false,
    }),
    isDouble: z.boolean().openapi({
        description: "Whether at least two dice are same (but not triple)",
        example: false,
    }),
    isAllDifferent: z.boolean().openapi({
        description: "Whether all three dice are unique",
        example: true,
    }),
    isConsecutive: z.boolean().openapi({
        description: "Whether dice form consecutive sequence",
        example: false,
    }),
    isBig: z.boolean().openapi({
        description: "Whether sum is 11-18",
        example: true,
    }),
    isSmall: z.boolean().openapi({
        description: "Whether sum is 3-10",
        example: false,
    }),
    isOdd: z.boolean().openapi({
        description: "Whether sum is odd",
        example: false,
    }),
    isEven: z.boolean().openapi({
        description: "Whether sum is even",
        example: true,
    }),
    userBet: z
        .object({
            id: z.uuid(),
            betAmount: z.number(),
            betType: z.enum([
                "SUM",
                "TRIPLE_ANY",
                "TRIPLE_SPECIFIC",
                "DOUBLE_ANY",
                "DOUBLE_SPECIFIC",
                "ALL_DIFFERENT",
                "TWO_NUMBERS",
                "CONSECUTIVE",
                "BIG",
                "SMALL",
                "ODD",
                "EVEN",
            ]),
            betChoice: z.string(),
            isWin: z.boolean(),
            winAmount: z.number(),
        })
        .nullable()
        .openapi({
            description: "User's bet for this period, null if no bet placed",
        }),
});
