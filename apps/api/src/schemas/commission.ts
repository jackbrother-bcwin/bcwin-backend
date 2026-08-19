import { z } from "@hono/zod-openapi";

export const page = z.coerce.number().optional().default(1).openapi({
    description: "Page number for pagination",
    example: 1,
});

export const limit = z.coerce.number().optional().default(30).openapi({
    description: "Number of items per page",
    example: 30,
});

// Request schemas
export const dailyCommissionQuerySchema = z.object({
    date: z.string().optional().openapi({
        description: "Date in YYYY-MM-DD format. Defaults to today",
        example: "2025-01-15",
    }),
    page,
    limit,
});

export const commissionBreakdownQuerySchema = z.object({
    startDate: z.string().optional().openapi({
        description: "Start date in YYYY-MM-DD format",
        example: "2025-01-01",
    }),
    endDate: z.string().optional().openapi({
        description: "End date in YYYY-MM-DD format",
        example: "2025-01-31",
    }),
    layer: z.string().optional().openapi({
        description: "Filter by layer (1-6)",
        example: "1",
    }),
});

export const teamQuerySchema = z.object({
    layer: z.string().optional().openapi({
        description:
            "Filter by layer (1-6). Omit or pass all for every tier",
        example: "1",
    }),
    username: z.string().optional().openapi({
        description: "Filter by username (case-insensitive partial match)",
        example: "user123",
    }),
    /** Optional IST calendar day (YYYY-MM-DD). When set, betting/deposit stats are for that day only. */
    date: z.string().optional().openapi({
        description:
            "Optional IST day YYYY-MM-DD — filter member betting/deposit stats to that day",
        example: "2026-04-08",
    }),
    page,
    limit,
});

// Response schemas
export const dailyCommissionSummarySchema = z.object({
    date: z.string().openapi({
        description: "Date of the commission summary",
        example: "2025-01-15",
    }),
    totalCommission: z.number().openapi({
        description: "Total commission earned for the day",
        example: 150.5,
    }),
    layer1Commission: z.number().openapi({
        description: "Commission from layer 1 subordinates",
        example: 100.25,
    }),
    layer2Commission: z.number().openapi({
        description: "Commission from layer 2 subordinates",
        example: 30.15,
    }),
    layer3Commission: z.number().openapi({
        description: "Commission from layer 3 subordinates",
        example: 10.1,
    }),
    layer4Commission: z.number().openapi({
        description: "Commission from layer 4 subordinates",
        example: 5.0,
    }),
    layer5Commission: z.number().openapi({
        description: "Commission from layer 5 subordinates",
        example: 3.0,
    }),
    layer6Commission: z.number().openapi({
        description: "Commission from layer 6 subordinates",
        example: 2.0,
    }),
});

export const commissionRecordSchema = z.object({
    id: z.string().openapi({
        description: "Commission record ID",
        example: "uuid-123",
    }),
    fromUser: z
        .object({
            id: z.string().openapi({
                description: "User ID of the subordinate",
                example: "user-123",
            }),
            username: z.string().openapi({
                description: "Username of the subordinate",
                example: "user123",
            }),
        })
        .openapi({
            description: "Subordinate user information",
        }),
    layer: z.number().openapi({
        description: "Layer level (1-6)",
        example: 1,
    }),
    userVipLevel: z.number().openapi({
        description: "VIP level at time of commission",
        example: 3,
    }),
    commissionRate: z.number().openapi({
        description: "Commission rate applied (%)",
        example: 0.4,
    }),
    betAmount: z.number().openapi({
        description: "Original bet amount",
        example: 100,
    }),
    commissionAmount: z.number().openapi({
        description: "Commission amount earned",
        example: 0.392,
    }),
    betType: z.string().openapi({
        description: "Type of game bet",
        example: "WINGO",
    }),
    createdAt: z.string().openapi({
        description: "Commission creation timestamp",
        example: "2025-01-15T12:30:00Z",
    }),
});

export const teamMemberSchema = z.object({
    id: z.string().openapi({
        description: "User ID",
        example: "user-123",
    }),
    username: z.string().openapi({
        description: "Username",
        example: "user123",
    }),
    mobileNumber: z.string().optional().openapi({
        description: "User mobile number",
        example: "919876543210",
    }),
    email: z.string().optional().openapi({
        description: "User email",
        example: "user@example.com",
    }),
    serialNumber: z.number().optional().openapi({
        description: "User serial number (UID)",
        example: 954983,
    }),
    layer: z.number().openapi({
        description: "Layer level from the current user",
        example: 1,
    }),
    totalBetting: z.number().openapi({
        description: "Total betting amount",
        example: 5000,
    }),
    betCount: z.number().optional().openapi({
        description: "Number of bets (lottery + inout) in the selected day/lifetime",
        example: 12,
    }),
    totalDeposit: z.number().openapi({
        description: "Total deposit amount",
        example: 10000,
    }),
    commissionGenerated: z.number().openapi({
        description:
            "Team rebate generated for the viewer from this downline (ADR-0011; accrued, settled+unsettled)",
        example: 250.5,
    }),
    createdAt: z.string().openapi({
        description: "User registration timestamp",
        example: "2025-01-01T00:00:00Z",
    }),
});

export const teamOverviewSchema = z.object({
    directTeamSize: z.number().openapi({
        description: "Number of direct team members (Layer 1)",
        example: 10,
    }),
    totalTeamSize: z.number().openapi({
        description: "Total team size across all layers",
        example: 45,
    }),
    totalTeamBetting: z.number().openapi({
        description: "Total betting amount from all team members",
        example: 50000,
    }),
    totalTeamDeposit: z.number().openapi({
        description: "Total deposit amount from all team members",
        example: 100000,
    }),
    totalCommissionEarned: z.number().openapi({
        description: "Total commission earned from team",
        example: 2500.5,
    }),
    /** Additive display fields (Agency hub) — optional for older clients */
    directTeamBetting: z.number().optional(),
    directTeamDeposit: z.number().optional(),
    directDepositCount: z.number().optional().openapi({
        description:
            "SUCCESS deposit rows (L1). Lifetime if no date; that IST day if date= is set.",
    }),
    teamDepositCount: z.number().optional().openapi({
        description:
            "SUCCESS deposit rows (L1–L6). Lifetime if no date; that IST day if date= is set.",
    }),
    directFirstDepositUsers: z.number().optional().openapi({
        description:
            "L1 users whose first SUCCESS deposit is in scope (all-time, or that IST day).",
    }),
    teamFirstDepositUsers: z.number().optional().openapi({
        description:
            "L1–L6 users whose first SUCCESS deposit is in scope (all-time, or that IST day).",
    }),
});
