import { z } from "@hono/zod-openapi";

// Response schemas
export const vipLevelRequirementSchema = z.object({
    level: z.number().openapi({
        description: "VIP level (0-10)",
        example: 1,
    }),
    expRequired: z.number().openapi({
        description: "Required cumulative XP to reach this level",
        example: 3000,
    }),
    levelUpReward: z.number().openapi({
        description: "Level up reward amount",
        example: 30,
    }),
    monthlyReward: z.number().openapi({
        description: "Monthly reward amount",
        example: 5,
    }),
    rebateRate: z.string().nullable().openapi({
        description: "Legacy display string — prefer selfRebatePercent",
        example: "0.3%",
    }),
    selfRebatePercent: z.number().optional().openapi({
        description: "Self-rebate % for this XP VIP (ADR-0021)",
        example: 0.1,
    }),
    teamSize: z.number().optional().openapi({
        description: "Required team size (legacy)",
        example: 0,
    }),
    teamBetting: z.number().optional().openapi({
        description: "Required total team betting amount (legacy)",
        example: 0,
    }),
    teamDeposit: z.number().optional().openapi({
        description: "Required total team deposit amount (legacy)",
        example: 0,
    }),
});

export const commissionRateSchema = z.object({
    vipLevel: z.number().openapi({
        description: "VIP level (0-10)",
        example: 1,
    }),
    layer1: z.number().openapi({
        description: "Commission rate for layer 1 (%)",
        example: 0.4,
    }),
    layer2: z.number().openapi({
        description: "Commission rate for layer 2 (%)",
        example: 0.3,
    }),
    layer3: z.number().openapi({
        description: "Commission rate for layer 3 (%)",
        example: 0.2,
    }),
    layer4: z.number().openapi({
        description: "Commission rate for layer 4 (%)",
        example: 0.1,
    }),
    layer5: z.number().openapi({
        description: "Commission rate for layer 5 (%)",
        example: 0.05,
    }),
    layer6: z.number().openapi({
        description: "Commission rate for layer 6 (%)",
        example: 0.05,
    }),
});

export const userVipStatusSchema = z.object({
    currentLevel: z.number().openapi({
        description: "XP VIP level (rewards only, ADR-0012)",
        example: 2,
    }),
    rebateLevel: z.number().openapi({
        description:
            "Agency rebate level 0–10 (team metrics; keys RebateRateConfig)",
        example: 1,
    }),
    nextLevel: z.number().nullable().openapi({
        description: "Next XP VIP level (null if at max level)",
        example: 3,
    }),
    xp: z.number().openapi({
        description: "User current cumulative XP",
        example: 5000,
    }),
    teamSize: z.number().openapi({
        description: "Current total team size (L1–L6)",
        example: 15,
    }),
    teamBetting: z.number().openapi({
        description: "Current total team betting amount (L1–L6)",
        example: 75000,
    }),
    teamDeposit: z.number().openapi({
        description: "Current total team deposit amount (L1–L6)",
        example: 150000,
    }),
    currentRequirements: vipLevelRequirementSchema.openapi({
        description: "Requirements for current level",
    }),
    nextRequirements: vipLevelRequirementSchema.nullable().openapi({
        description: "Requirements for next level (null if at max level)",
    }),
    progress: z.object({
        xp: z.number().openapi({
            description: "Progress percentage towards next level XP requirement",
            example: 45.2,
        }),
    }).nullable().openapi({
        description: "Progress towards next level (null if at max level)",
    }),
    commissionRates: commissionRateSchema.nullable().optional().openapi({
        description: "Commission rates for current VIP level",
    }),
    lastCalculatedAt: z.string().openapi({
        description: "Last VIP level calculation timestamp",
        example: "2025-01-15T02:00:00Z",
    }),
    monthlyClaim: z
        .object({
            level: z.number(),
            canClaim: z.boolean(),
            nextClaimAt: z.string().nullable(),
            lastClaimAt: z.string().nullable(),
        })
        .optional()
        .openapi({
            description:
                "Current-VIP monthly reward window (once per IST month, after holding into a new month)",
        }),
});

export const claimVipRewardSchema = z.object({
    level: z.number().int().min(1).max(10).openapi({
        description: "VIP level of reward to claim (1-10)",
        example: 2,
    }),
    type: z.enum(["LEVEL_UP", "MONTHLY"]).openapi({
        description: "Type of VIP reward to claim",
        example: "LEVEL_UP",
    }),
});

export const vipRewardClaimsQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1).openapi({
        description: "Page number",
        example: 1,
    }),
    limit: z.coerce.number().int().min(1).max(100).default(10).openapi({
        description: "Items per page",
        example: 10,
    }),
    type: z.enum(["LEVEL_UP", "MONTHLY", "all"]).optional().default("all").openapi({
        description: "Filter by reward type",
        example: "all",
    }),
});

export const vipRewardClaimRecordSchema = z.object({
    id: z.string().openapi({
        description: "Reward claim ID",
        example: "uuid",
    }),
    level: z.number().openapi({
        description: "VIP level of the reward",
        example: 2,
    }),
    type: z.enum(["LEVEL_UP", "MONTHLY"]).openapi({
        description: "Reward type",
        example: "LEVEL_UP",
    }),
    amount: z.number().openapi({
        description: "Claimed reward amount",
        example: 150,
    }),
    monthYear: z.string().nullable().openapi({
        description: "Month and year string for monthly reward (e.g., '2026-07')",
        example: "2026-07",
    }),
    createdAt: z.string().openapi({
        description: "Claim timestamp",
        example: "2026-07-23T10:00:00Z",
    }),
});
