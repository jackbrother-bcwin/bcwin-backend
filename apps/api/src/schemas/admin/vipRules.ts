import { z } from "@hono/zod-openapi";

export const createVipRuleSchema = z.object({
    level: z.number().min(0).openapi({
        description: "VIP level (0-10)",
        example: 1,
    }),
    expRequired: z.number().min(0).default(0).openapi({
        description: "Required cumulative XP to reach this level",
        example: 3000,
    }),
    levelUpReward: z.number().min(0).default(0).openapi({
        description: "Level up reward amount",
        example: 30,
    }),
    monthlyReward: z.number().min(0).default(0).openapi({
        description: "Monthly reward amount",
        example: 5,
    }),
    rebateRate: z.string().optional().nullable().openapi({
        description: "Rebate rate string (e.g., '0.3%')",
        example: "0.3%",
    }),
    teamSize: z.number().min(0).default(0).optional().openapi({
        description: "Required team size (legacy)",
        example: 0,
    }),
    teamBetting: z.number().min(0).default(0).optional().openapi({
        description: "Required total team betting amount (legacy)",
        example: 0,
    }),
    teamDeposit: z.number().min(0).default(0).optional().openapi({
        description: "Required total team deposit amount (legacy)",
        example: 0,
    }),
    vipName: z.string().optional().openapi({
        description: "Name of the VIP level",
        example: "VIP 1",
    }),
    minBet: z.number().min(0).optional().openapi({
        description: "Minimum personal betting required",
        example: 1000,
    }),
    oneTimeBonus: z.number().min(0).optional().openapi({
        description: "One time upgrade bonus",
        example: 500,
    }),
    monthlyBonus: z.number().min(0).optional().openapi({
        description: "Monthly maintenance bonus",
        example: 200,
    }),
    rebatePercentage: z.number().min(0).max(100).optional().openapi({
        description: "Rebate percentage for this VIP level",
        example: 0.5,
    }),
});

export const updateVipRuleSchema = createVipRuleSchema.partial();
