import { z } from "@hono/zod-openapi";

export const periodResponseSchema = z.object({
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
    blockNumber: z.number().nullable().openapi({
        description: "Block number, null if not resolved",
        example: 76541765,
    }),
    blockHash: z.string().nullable().openapi({
        description: "Block hash, null if not resolved",
        example:
            "815d3abeb02bfc43e2215345d764ef0bc84c1a85cd367b0ebcefad9ae7f81c19",
    }),
    blockTimestamp: z.string().nullable().openapi({
        description: "Block timestamp, null if not resolved",
        example: "1760285883000",
    }),
    status: z.enum(["ACTIVE", "ENDED", "RESOLVED"]).openapi({
        description: "Period status",
        example: "ACTIVE",
    }),
});
