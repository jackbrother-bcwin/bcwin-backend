import { z } from "@hono/zod-openapi";

export const inoutGameCategorySchema = z
    .enum([
        "instant",
        "crash_game",
        "slots",
        "roulette"
    ])
    .openapi({
        description: "Game Category",
        example: "instant",
    });

export const inoutGameSchema = z.object({
    id: z.string().openapi({
        description: "Game ID",
        example: "123e4567-e89b-12d3-a456-426614174000",
    }),
    title: z.string().openapi({
        description: "Game title",
        example: "plinko",
    }),
    gameMode: z.string().openapi({
        description: "Game mode (game id)",
        example: "plinko",
    }),
    description: z.string().openapi({
        description: "Game description",
        example: "plinko description",
    }),
    icon: z.url().openapi({
        description: "Game icon",
        example: "https://icons.inout.games/io_sugar-daddy.png",
    }),
    category: inoutGameCategorySchema.openapi({
        description: "Game category",
        example: "instant",
    }),
    multiplayer: z.boolean().openapi({
        description: "Whether the game is multiplayer",
        example: true,
    }),
    rtp: z.number().openapi({
        description: "Game RTP",
        example: 0.96,
    }),
    bonusTypes: z.array(z.string()).openapi({
        description: "Game bonus types",
        example: ["FREEBET"],
    }),
    createdAt: z.string().openapi({
        description: "Creation timestamp",
        example: "2024-01-01T00:00:00.000Z",
    }),
    updatedAt: z.string().openapi({
        description: "Last update timestamp",
        example: "2024-01-01T00:00:00.000Z",
    }),
});

export const inoutGamesListQuerySchema = z.object({
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
        .max(100)
        .default(20)
        .openapi({
            description: "Items per page (max 100)",
            example: 20,
            param: { name: "limit", in: "query" },
        }),
    category: inoutGameCategorySchema.optional().openapi({
        description: "Filter by game category",
        example: "instant",
        param: { name: "category", in: "query" },
    }),
    search: z
        .string()
        .optional()
        .openapi({
            description: "Search by game name",
            example: "plinko",
            param: { name: "search", in: "query" },
        }),
});

export const inoutGamesListResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    data: z.array(inoutGameSchema).openapi({
        description: "Array of games",
    }),
    total: z.number().openapi({
        description: "Total number of games",
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
