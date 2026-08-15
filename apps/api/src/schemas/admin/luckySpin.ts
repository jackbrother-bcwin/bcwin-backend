import { z } from "@hono/zod-openapi";

// Rule Schemas

export const luckySpinRuleSchema = z.object({
    id: z.string().uuid(),
    minDeposit: z.number(),
    spinChances: z.number().int(),
    isActive: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
});

export const getLuckySpinRulesResponseSchema = z.object({
    success: z.boolean(),
    data: z.array(luckySpinRuleSchema),
});

export const createLuckySpinRuleBodySchema = z.object({
    minDeposit: z.number().min(0).openapi({
        description: "Minimum deposit required to get the spin chances",
        example: 500,
    }),
    spinChances: z.number().int().min(0).openapi({
        description: "Number of extra spins granted",
        example: 1,
    }),
    isActive: z.boolean().optional().default(true).openapi({
        description: "Whether the rule is active",
        example: true,
    }),
});

export const updateLuckySpinRuleBodySchema = createLuckySpinRuleBodySchema.partial();

export const luckySpinRuleResponseSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    data: luckySpinRuleSchema,
});

// Reward Schemas

export const luckySpinRewardSchema = z.object({
    id: z.string().uuid(),
    amount: z.number(),
    probability: z.number(),
    isActive: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
});

export const getLuckySpinRewardsResponseSchema = z.object({
    success: z.boolean(),
    data: z.array(luckySpinRewardSchema),
});

export const createLuckySpinRewardBodySchema = z.object({
    amount: z.number().min(0).openapi({
        description: "The reward amount in currency",
        example: 10,
    }),
    probability: z.number().min(0).openapi({
        description: "Weight for weighted random selection (higher is more common)",
        example: 15,
    }),
    isActive: z.boolean().optional().default(true).openapi({
        description: "Whether the reward is active",
        example: true,
    }),
});

export const updateLuckySpinRewardBodySchema = createLuckySpinRewardBodySchema.partial();

export const luckySpinRewardResponseSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    data: luckySpinRewardSchema,
});

export const deleteResponseSchema = z.object({
    success: z.boolean(),
    message: z.string(),
});
