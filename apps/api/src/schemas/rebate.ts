import { z } from "@hono/zod-openapi";

export const page = z.coerce.number().optional().default(1).openapi({
    description: "Page number for pagination",
    example: 1,
});

export const limit = z.coerce.number().optional().default(30).openapi({
    description: "Number of items per page",
    example: 30,
});

export const rebateCategorySchema = z
    .enum(["LOTTERY", "SLOTS", "CASINO", "SPORTS", "RUMMY"])
    .openapi({
        description: "Game category for rebate rates",
        example: "LOTTERY",
    });

// Request schemas
export const rebateHistoryQuerySchema = z.object({
    date: z.string().optional().openapi({
        description: "Single day YYYY-MM-DD (legacy)",
        example: "2025-01-15",
    }),
    startDate: z.string().optional().openapi({
        description: "Range start YYYY-MM-DD (inclusive, IST preferred)",
        example: "2025-01-01",
    }),
    endDate: z.string().optional().openapi({
        description: "Range end YYYY-MM-DD (inclusive)",
        example: "2025-01-31",
    }),
    settled: z.string().optional().openapi({
        description:
            "Filter settled status: true (default — post 01:30 IST), false (pending only), all",
        example: "true",
    }),
    game: z.string().optional().openapi({
        description:
            "Filter by game type (WINGO, TRXWINGO, K3, 5D, MOTO, INOUT)",
        example: "WINGO",
    }),
    category: rebateCategorySchema.optional().openapi({
        description: "Filter by rebate game category",
        example: "LOTTERY",
    }),
    fromUserId: z.string().optional().openapi({
        description:
            "Filter to rebates from one downline (UUID). Used for agent commission expand pagination.",
        example: "uuid-downline",
    }),
    layer: z.coerce.number().int().min(1).max(6).optional().openapi({
        description: "Filter to invite layer 1–6",
        example: 2,
    }),
    page,
    limit,
});

// Response schemas
export const rebateRecordSchema = z.object({
    id: z.string().openapi({
        description: "Rebate record ID",
        example: "uuid-123",
    }),
    amount: z.number().openapi({
        description: "Rebate amount",
        example: 5.5,
    }),
    game: z.string().openapi({
        description: "Game type",
        example: "WINGO",
    }),
    gameCategory: z
        .string()
        .nullable()
        .optional()
        .openapi({
            description: "LOTTERY | CASINO | SPORTS | RUMMY",
            example: "LOTTERY",
        }),
    layer: z.number().nullable().optional().openapi({
        description: "Upline layer 1–6",
        example: 1,
    }),
    rate: z.number().nullable().optional().openapi({
        description: "Rate % applied",
        example: 0.5,
    }),
    betAmount: z.number().nullable().optional().openapi({
        description: "Original bet amount",
        example: 100,
    }),
    receiverVip: z.number().nullable().optional().openapi({
        description: "Receiver VIP level at accrual",
        example: 0,
    }),
    fromUser: z
        .object({
            id: z.string().optional(),
            username: z.string().optional(),
            serialNumber: z.number().optional(),
        })
        .nullable()
        .optional(),
    settled: z.boolean().openapi({
        description: "Whether the rebate has been settled",
        example: false,
    }),
    createdAt: z.string().openapi({
        description: "Rebate creation timestamp",
        example: "2025-01-15T12:30:00Z",
    }),
});
