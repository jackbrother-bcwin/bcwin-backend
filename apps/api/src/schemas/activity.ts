import { z } from "@hono/zod-openapi";

// ============================================================================
// ENUMS
// ============================================================================

export const activityBonusTypeSchema = z
    .enum([
        "WEEKLY",
        "DAILY",
        "INVITATION",
        "FIRST_DEPOSIT",
        "ATTENDENCE",
        "SPIN_WHEEL",
        "WIN_STREAK",
        "INR_RECHARGE_BONUS",
        "USDT_RECHARGE_BONUS",
    ])
    .openapi({
        description: "Type of activity bonus",
        example: "WEEKLY",
    });

export const activityBonusStatusSchema = z
    .enum(["PENDING", "COMPLETED_UNCOLLECTED", "COLLECTED", "EXPIRED"])
    .openapi({
        description: "Status of activity bonus",
        example: "COMPLETED_UNCOLLECTED",
    });

// ============================================================================
// COMMON SCHEMAS
// ============================================================================

export const activityBonusSchema = z.object({
    id: z.string().openapi({
        description: "Bonus ID",
        example: "123e4567-e89b-12d3-a456-426614174000",
    }),
    userId: z.string().openapi({
        description: "User ID",
        example: "123e4567-e89b-12d3-a456-426614174000",
    }),
    type: activityBonusTypeSchema,
    status: activityBonusStatusSchema,
    amount: z.number().openapi({
        description: "Bonus amount",
        example: 100,
    }),
    metadata: z
        .any()
        .optional()
        .openapi({
            description: "Bonus metadata including tier and requirements",
            example: { tier: 1, requirement: 10000, achieved: 15000 },
        }),
    expiresAt: z.string().optional().openapi({
        description: "Expiration date",
        example: "2024-12-31T23:59:59.000Z",
    }),
    claimAt: z.string().optional().openapi({
        description: "Claim date",
        example: "2024-12-31T23:59:59.000Z",
    }),
    createdAt: z.string().openapi({
        description: "Creation date",
        example: "2024-12-31T23:59:59.000Z",
    }),
    updatedAt: z.string().openapi({
        description: "Last update date",
        example: "2024-12-31T23:59:59.000Z",
    }),
});

// ============================================================================
// TIER PROGRESS SCHEMAS
// ============================================================================

const weeklyTierProgressSchema = z.object({
    tier: z.number().openapi({
        description: "Tier number",
        example: 0,
    }),
    requirement: z
        .object({
            slotBet: z.number(),
        })
        .openapi({
            description: "Requirement to complete tier",
            example: { slotBet: 10000 },
        }),
    current: z
        .object({
            slotBet: z.number(),
        })
        .openapi({
            description: "Current progress",
            example: { slotBet: 5000 },
        }),
    reward: z.number().openapi({
        description: "Reward amount",
        example: 25,
    }),
    completed: z.boolean().openapi({
        description: "Whether tier is completed",
        example: false,
    }),
    claimed: z.boolean().openapi({
        description: "Whether tier reward is claimed",
        example: false,
    }),
    expired: z.boolean().optional().openapi({
        description: "Whether tier reward is expired",
        example: false,
    }),
    bonusId: z.string().nullable().optional().openapi({
        description:
            "Bonus ID if bonus record exists in database. Can be null when tier requirements are just met but background job hasn't created the bonus record yet. Use this ID to fetch full bonus details or claim the reward.",
        example: "123e4567-e89b-12d3-a456-426614174000",
    }),
});

const dailyTierProgressSchema = z.object({
    tier: z.number().openapi({
        description: "Tier number",
        example: 0,
    }),
    requirement: z
        .object({
            deposit: z.number(),
            slotBet: z.number(),
        })
        .openapi({
            description: "Requirements to complete tier",
            example: { deposit: 100, slotBet: 300 },
        }),
    current: z
        .object({
            deposit: z.number(),
            slotBet: z.number(),
        })
        .openapi({
            description: "Current progress",
            example: { deposit: 50, slotBet: 150 },
        }),
    reward: z.number().openapi({
        description: "Reward amount",
        example: 8,
    }),
    completed: z.boolean().openapi({
        description: "Whether tier is completed",
        example: false,
    }),
    claimed: z.boolean().openapi({
        description: "Whether tier reward is claimed",
        example: false,
    }),
    expired: z.boolean().optional().openapi({
        description: "Whether tier reward is expired",
        example: false,
    }),
    bonusId: z.string().nullable().optional().openapi({
        description:
            "Bonus ID if bonus record exists in database. Can be null when tier requirements are just met but background job hasn't created the bonus record yet. Use this ID to fetch full bonus details or claim the reward.",
        example: "123e4567-e89b-12d3-a456-426614174000",
    }),
});

const invitationTierProgressSchema = z.object({
    tier: z.number().openapi({
        description: "Tier number",
        example: 0,
    }),
    requirement: z
        .object({
            invites: z.number(),
            minDepositPerInvite: z.number(),
        })
        .openapi({
            description:
                "Requirements to complete tier - number of invites needed where each invited user has deposited at least minDepositPerInvite",
            example: { invites: 1, minDepositPerInvite: 100 },
        }),
    current: z
        .object({
            qualifyingInvites: z.number(),
        })
        .openapi({
            description:
                "Current count of invited users who have deposited at least the required amount",
            example: { qualifyingInvites: 0 },
        }),
    reward: z.number().openapi({
        description: "Reward amount",
        example: 8,
    }),
    completed: z.boolean().openapi({
        description: "Whether tier is completed",
        example: false,
    }),
    claimed: z.boolean().openapi({
        description: "Whether tier reward is claimed",
        example: false,
    }),
    expired: z.boolean().optional().openapi({
        description: "Whether tier reward is expired",
        example: false,
    }),
    bonusId: z.string().nullable().optional().openapi({
        description:
            "Bonus ID if bonus record exists in database. Can be null when tier requirements are just met but background job hasn't created the bonus record yet. Use this ID to fetch full bonus details or claim the reward.",
        example: "123e4567-e89b-12d3-a456-426614174000",
    }),
});

const attendanceTierProgressSchema = z.object({
    tier: z.number().openapi({
        description: "Tier number",
        example: 0,
    }),
    day: z.number().openapi({
        description: "Day number",
        example: 1,
    }),
    requirement: z
        .object({
            day: z.number(),
            accumulatedDeposit: z.number(),
        })
        .openapi({
            description: "Requirements to complete tier",
            example: { day: 1, accumulatedDeposit: 100 },
        }),
    current: z
        .object({
            day: z.number(),
            accumulatedDeposit: z.number(),
        })
        .openapi({
            description: "Current progress",
            example: { day: 1, accumulatedDeposit: 50 },
        }),
    reward: z.number().openapi({
        description: "Reward amount",
        example: 2,
    }),
    completed: z.boolean().openapi({
        description: "Whether tier is completed",
        example: false,
    }),
    claimed: z.boolean().openapi({
        description: "Whether tier reward is claimed",
        example: false,
    }),
    expired: z.boolean().optional().openapi({
        description: "Whether tier reward is expired",
        example: false,
    }),
    bonusId: z.string().nullable().optional().openapi({
        description: "Bonus ID if bonus exists for this tier",
        example: "123e4567-e89b-12d3-a456-426614174000",
    }),
});

const firstDepositTierSchema = z.object({
    tier: z.number().openapi({
        description: "Tier number",
        example: 0,
    }),
    requirement: z
        .object({
            deposit: z.number(),
        })
        .openapi({
            description: "Deposit requirement for this tier (₹300–₹100000)",
            example: { deposit: 300 },
        }),
    current: z
        .object({
            deposit: z.number(),
        })
        .optional()
        .openapi({
            description:
                "Progress for THIS tier only (0 when unavailable; never multi-fill all bars)",
            example: { deposit: 300 },
        }),
    reward: z.number().openapi({
        description: "Reward amount for this tier",
        example: 28,
    }),
    eligible: z.boolean().openapi({
        description:
            "True only for the max qualifying first-deposit tier while COMPLETED_UNCOLLECTED",
        example: true,
    }),
    claimed: z.boolean().openapi({
        description: "Whether this tier has been claimed (once only)",
        example: false,
    }),
    unavailable: z.boolean().optional().openapi({
        description:
            "True for non-winning tiers after first deposit (locked out)",
        example: false,
    }),
    bonusId: z.string().nullable().optional().openapi({
        description:
            "Bonus ID for claim when this is the active uncollected tier",
        example: "123e4567-e89b-12d3-a456-426614174000",
    }),
});

// ============================================================================
// PROGRESS RESPONSE SCHEMA
// ============================================================================

export const activityProgressResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    data: z.object({
        weekly: z.array(weeklyTierProgressSchema).openapi({
            description: "Weekly bonus tiers progress",
        }),
        daily: z.array(dailyTierProgressSchema).openapi({
            description: "Daily bonus tiers progress",
        }),
        invitation: z.array(invitationTierProgressSchema).openapi({
            description: "Invitation bonus tiers progress",
        }),
        firstDeposit: z
            .object({
                tiers: z.array(firstDepositTierSchema),
                currentDeposit: z.number(),
                eligible: z.boolean(),
                claimed: z.boolean(),
                claimedTier: z.number().optional(),
                offerPopup: z.boolean().optional().openapi({
                    description:
                        "Home popup: true if not collected and (no deposit yet or uncollected bonus)",
                }),
            })
            .openapi({
                description:
                    "First deposit bonus — max tier only; claim once with bank",
            }),
        attendance: z
            .object({
                currentStreak: z.number(),
                tiers: z.array(attendanceTierProgressSchema),
            })
            .openapi({
                description: "Attendance bonus progress",
            }),
    }),
});

// ============================================================================
// BONUSES LIST SCHEMAS
// ============================================================================

export const activityBonusListQuerySchema = z.object({
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
    type: activityBonusTypeSchema.optional().openapi({
        description: "Filter by bonus type",
        param: { name: "type", in: "query" },
    }),
    status: activityBonusStatusSchema.optional().openapi({
        description: "Filter by bonus status",
        param: { name: "status", in: "query" },
    }),
});

export const activityBonusListResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    data: z.array(activityBonusSchema).openapi({
        description: "Array of activity bonuses",
    }),
    total: z.number().openapi({
        description: "Total number of bonuses",
        example: 50,
    }),
    currentPage: z.number().openapi({
        description: "Current page number",
        example: 1,
    }),
    totalPages: z.number().openapi({
        description: "Total number of pages",
        example: 3,
    }),
});

// ============================================================================
// CLAIM BONUS SCHEMAS
// ============================================================================

export const claimBonusParamsSchema = z.object({
    bonusId: z.string().openapi({
        description: "Bonus ID to claim",
        example: "123e4567-e89b-12d3-a456-426614174000",
        param: { name: "bonusId", in: "path" },
    }),
});

export const claimBonusResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the claim was successful",
        example: true,
    }),
    data: z.object({
        bonus: activityBonusSchema,
        newBalance: z.number().openapi({
            description: "User's new balance after claim",
            example: 1250.5,
        }),
    }),
});

// ============================================================================
// HISTORY SCHEMAS
// ============================================================================

export const activityHistoryQuerySchema = z.object({
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
    type: activityBonusTypeSchema.optional().openapi({
        description: "Filter by bonus type",
        param: { name: "type", in: "query" },
    }),
});

export const activityHistoryResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    data: z.array(activityBonusSchema).openapi({
        description: "Array of claimed activity bonuses",
    }),
    total: z.number().openapi({
        description: "Total number of claimed bonuses",
        example: 50,
    }),
    currentPage: z.number().openapi({
        description: "Current page number",
        example: 1,
    }),
    totalPages: z.number().openapi({
        description: "Total number of pages",
        example: 3,
    }),
});
