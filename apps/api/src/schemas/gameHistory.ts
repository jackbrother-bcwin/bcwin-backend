import { z } from "@hono/zod-openapi";

export const majorGameTypeSchema = z
    .enum(["WINGO", "FIVE_D", "K3", "MOTO", "TRX_WINGO", "INOUT"])
    .openapi({
        description: "Major game type",
        example: "WINGO",
    });

export const gameHistoryQuerySchema = z.object({
    page: z.coerce
        .number()
        .int()
        .positive()
        .default(1)
        .openapi({
            description: "Page number",
            example: 1,
            param: { name: "page", in: "query" },
        }),
    limit: z.coerce
        .number()
        .int()
        .positive()
        .max(200)
        .default(20)
        .openapi({
            description: "Items per page (max 200)",
            example: 20,
            param: { name: "limit", in: "query" },
        }),
    majorGameType: majorGameTypeSchema.optional().openapi({
        description: "Filter by major game type",
        param: { name: "majorGameType", in: "query" },
    })
});

export const gameHistoryBetSchema = z.object({
    id: z.string().openapi({
        description: "Bet ID",
        example: "123e4567-e89b-12d3-a456-426614174000",
    }),
    majorGameType: majorGameTypeSchema.openapi({
        description: "Major game type",
    }),
    gameName: z.string().openapi({
        description: "Game name or identifier",
        example: "Wingo 1Min",
    }),
    betAmount: z.number().openapi({
        description: "Bet amount",
        example: 100,
    }),
    winAmount: z.number().openapi({
        description: "Win amount (0 if lost)",
        example: 200,
    }),
    status: z.string().openapi({
        description: "Bet status",
        example: "SETTLED",
    }),
    createdAt: z.string().openapi({
        description: "Bet creation timestamp",
        example: "2024-01-01T00:00:00.000Z",
    }),
    metadata: z.record(z.string(), z.any()).optional().openapi({
        description: "Additional game-specific metadata",
    }),
});

export const gameHistoryResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    data: z.array(gameHistoryBetSchema).openapi({
        description: "Array of bets across all games",
    }),
    total: z.number().openapi({
        description: "Total number of bets",
        example: 150,
    }),
    currentPage: z.number().openapi({
        description: "Current page number",
        example: 1,
    }),
    totalPages: z.number().openapi({
        description: "Total number of pages",
        example: 8,
    }),
});
