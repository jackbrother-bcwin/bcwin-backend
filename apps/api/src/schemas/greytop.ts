// import { z } from "@hono/zod-openapi";

// export const greytopGameTypeSchema = z
//     .enum([
//         "MINI",
//         "FISHING",
//         "SLOT",
//         "RUMMY",
//         "LIVE_CASINO",
//         "SPORTS",
//         "OTHER",
//     ])
//     .openapi({
//         description: "Game type",
//         example: "MINI",
//     });

// export const greytopGameSchema = z.object({
//     id: z.string().openapi({
//         description: "Game ID",
//         example: "123e4567-e89b-12d3-a456-426614174000",
//     }),
//     name: z.string().openapi({
//         description: "Game name",
//         example: "Aviator",
//     }),
//     uid: z.string().openapi({
//         description: "Game UID",
//         example: "a04d1f3eb8ccec8a4823bdf18e3f0e84",
//     }),
//     providerName: z.string().openapi({
//         description: "Provider name",
//         example: "Spribe",
//     }),
//     providerCode: z.string().openapi({
//         description: "Provider code",
//         example: "150",
//     }),
//     type: z.array(greytopGameTypeSchema).openapi({
//         description: "Game types",
//         example: ["MINI", "SLOT"],
//     }),
//     createdAt: z.string().openapi({
//         description: "Creation timestamp",
//         example: "2024-01-01T00:00:00.000Z",
//     }),
//     updatedAt: z.string().openapi({
//         description: "Last update timestamp",
//         example: "2024-01-01T00:00:00.000Z",
//     }),
// });

// export const greytopGamesListQuerySchema = z.object({
//     page: z.coerce
//         .number()
//         .int()
//         .positive()
//         .default(1)
//         .openapi({
//             description: "Page number",
//             example: 1,
//             param: { name: "page", in: "query" },
//         }),
//     limit: z.coerce
//         .number()
//         .int()
//         .positive()
//         .max(100)
//         .default(20)
//         .openapi({
//             description: "Items per page (max 100)",
//             example: 20,
//             param: { name: "limit", in: "query" },
//         }),
//     type: greytopGameTypeSchema.optional().openapi({
//         description: "Filter by game type",
//         param: { name: "type", in: "query" },
//     }),
//     providerCode: z
//         .string()
//         .optional()
//         .openapi({
//             description: "Filter by provider code",
//             example: "150",
//             param: { name: "providerCode", in: "query" },
//         }),
//     providerName: z
//         .string()
//         .optional()
//         .openapi({
//             description: "Filter by provider name",
//             example: "Spribe",
//             param: { name: "providerName", in: "query" },
//         }),
//     search: z
//         .string()
//         .optional()
//         .openapi({
//             description: "Search by game name",
//             example: "aviator",
//             param: { name: "search", in: "query" },
//         }),
// });

// export const greytopGamesListResponseSchema = z.object({
//     success: z.boolean().openapi({
//         description: "Whether the request was successful",
//         example: true,
//     }),
//     data: z.array(greytopGameSchema).openapi({
//         description: "Array of games",
//     }),
//     total: z.number().openapi({
//         description: "Total number of games",
//         example: 150,
//     }),
//     currentPage: z.number().openapi({
//         description: "Current page number",
//         example: 1,
//     }),
//     totalPages: z.number().openapi({
//         description: "Total number of pages",
//         example: 8,
//     }),
// });
