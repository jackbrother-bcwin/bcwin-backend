import { z } from "@hono/zod-openapi";

export const winStreakRuleSchema = z.object({
    id: z.string().uuid(),
    consecutiveWins: z.number().int().positive(),
    bonusPercentage: z.number().positive(),
    isActive: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
});

export const getWinStreakRulesResponseSchema = z.object({
    success: z.boolean(),
    data: z.array(winStreakRuleSchema),
});

export const createWinStreakRuleBodySchema = z.object({
    consecutiveWins: z
        .number()
        .int()
        .positive()
        .openapi({ description: "Number of consecutive wins required", example: 2 }),
    bonusPercentage: z
        .number()
        .positive()
        .max(100)
        .openapi({ description: "Bonus percentage of total streak winnings, e.g. 10 = 10%", example: 10 }),
    isActive: z.boolean().default(true).openapi({ description: "Whether this rule is active" }),
});

export const createWinStreakRuleResponseSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    data: winStreakRuleSchema,
});

export const updateWinStreakRuleBodySchema = z.object({
    bonusPercentage: z.number().positive().max(100).optional(),
    isActive: z.boolean().optional(),
});

export const deleteWinStreakRuleResponseSchema = z.object({
    success: z.boolean(),
    message: z.string(),
});
