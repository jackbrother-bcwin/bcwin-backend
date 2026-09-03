import { z } from "@hono/zod-openapi";
import { limit, page } from "@/schemas";

// User list query schema
export const GetUsersQuerySchema = z.object({
    page,
    limit,
    search: z.string().optional().openapi({
        description: "Search by mobile, username, email/referral code, UUID, or exact serial prefixed with #",
        example: "user123",
    }),
    isBanned: z.enum(["true", "false"]).optional().openapi({
        description: "Filter by banned status",
        example: "false",
    }),
    hasIllegalBetPenalty: z.enum(["true", "false"]).optional().openapi({
        description: "Filter by penalty status",
        example: "false",
    }),
    role: z.enum(["USER", "ADMIN", "SUB_ADMIN", "AGENT"]).optional().openapi({
        description: "Filter by user role",
        example: "USER",
    }),
    isDemo: z.enum(["true", "false"]).optional().openapi({
        description: "Filter by demo account status",
        example: "false",
    }),
});

// User item schema
export const UserItemSchema = z.object({
    id: z.string().openapi({
        description: "User ID",
        example: "uuid-123",
    }),
    serialNumber: z.number().openapi({
        description: "User serial number",
        example: 8400,
    }),
    username: z.string().openapi({
        description: "Username",
        example: "user123",
    }),
    mobileNumber: z.string().openapi({
        description: "Mobile number",
        example: "9876543210",
    }),
    balance: z.number().openapi({
        description: "User balance",
        example: 1000.5,
    }),
    isBanned: z.boolean().openapi({
        description: "Is user banned",
        example: false,
    }),
    hasIllegalBetPenalty: z.boolean().openapi({
        description: "Has illegal bet withdrawal penalty",
        example: false,
    }),
    illegalBetPenaltyFactor: z.number().nullable().openapi({
        description: "Withdrawal penalty factor",
        example: 3.0,
    }),
    isDemo: z.boolean().openapi({
        description: "Is demo account",
        example: false,
    }),
    role: z.string().openapi({
        description: "User role",
        example: "USER",
    }),
    referralCode: z.string().openapi({
        description: "User referral code",
        example: "ABC123",
    }),
    referredBy: z.string().nullable().openapi({
        description: "Referral code used by user",
        example: "XYZ789",
    }),
    createdAt: z.string().openapi({
        description: "Account creation timestamp",
        example: "2025-01-12T10:30:00Z",
    }),
});

export const SubAdminItemSchema = UserItemSchema.omit({
    isDemo: true,
    referralCode: true,
    referredBy: true,
});

export const AgentItemSchema = UserItemSchema.omit({
    isDemo: true,
    referralCode: true,
    referredBy: true,
});

// User list response schema
export const GetUsersResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    users: z.array(UserItemSchema),
    total: z.number().openapi({
        description: "Total number of users",
        example: 150,
    }),
    currentPage: z.number().openapi({
        description: "Current page number",
        example: 1,
    }),
    totalPages: z.number().openapi({
        description: "Total number of pages",
        example: 5,
    }),
});

// Single user stats schema
// export const UserStatsSchema = z.object({
//     id: z.string().openapi({
//         description: "User ID",
//         example: "uuid-123",
//     }),
//     username: z.string().openapi({
//         description: "Username",
//         example: "user123",
//     }),
//     mobileNumber: z.string().openapi({
//         description: "Mobile number",
//         example: "9876543210",
//     }),
//     balance: z.number().openapi({
//         description: "User balance",
//         example: 1000.5,
//     }),
//     isBanned: z.boolean().openapi({
//         description: "Is user banned",
//         example: false,
//     }),
//     isDemo: z.boolean().openapi({
//         description: "Is demo account",
//         example: false,
//     }),
//     role: z.string().openapi({
//         description: "User role",
//         example: "USER",
//     }),
//     referralCode: z.string().openapi({
//         description: "User referral code",
//         example: "ABC123",
//     }),
//     referredBy: z.string().nullable().openapi({
//         description: "Referral code used by user",
//         example: "XYZ789",
//     }),
//     createdAt: z.string().openapi({
//         description: "Account creation timestamp",
//         example: "2025-01-12T10:30:00Z",
//     }),
//     bank: z
//         .object({
//             fullName: z.string().nullable(),
//             bankAccount: z.string().nullable(),
//             ifsc: z.string().nullable(),
//             tronAddress: z.string().nullable(),
//             upiId: z.string().nullable(),
//         })
//         .nullable()
//         .openapi({
//             description: "User bank details",
//         }),
//     stats: z.object({
//         totalRecharge: z.number().openapi({
//             description: "Total recharge amount",
//             example: 5000,
//         }),
//         directRecharge: z.number().openapi({
//             description: "Direct downlinks (level 1) recharge",
//             example: 3000,
//         }),
//         downlinkRecharge: z.number().openapi({
//             description: "All downlinks (level 1-6) recharge",
//             example: 8000,
//         }),
//         totalWithdraw: z.number().openapi({
//             description: "Total withdraw amount",
//             example: 2000,
//         }),
//         directWithdraw: z.number().openapi({
//             description: "Direct downlinks (level 1) withdraw",
//             example: 1500,
//         }),
//         downlinkWithdraw: z.number().openapi({
//             description: "All downlinks (level 1-6) withdraw",
//             example: 4000,
//         }),
//         totalBet: z.number().openapi({
//             description: "Total bet amount",
//             example: 10000,
//         }),
//         directBet: z.number().openapi({
//             description: "Direct downlinks (level 1) bet",
//             example: 6000,
//         }),
//         downlinkBet: z.number().openapi({
//             description: "All downlinks (level 1-6) bet",
//             example: 20000,
//         }),
//         allDownlinksCount: z.number().openapi({
//             description: "Total downlinks count (level 1-6)",
//             example: 45,
//         }),
//         directDownlinksCount: z.number().openapi({
//             description: "Direct downlinks count (level 1 only)",
//             example: 10,
//         }),
//     }),
// });

export const UserStatsSchema = UserItemSchema.extend({
    bank: z
        .object({
            fullName: z.string().nullable(),
            bankAccount: z.string().nullable(),
            ifsc: z.string().nullable(),
            trc20Address: z.string().nullable(),
            bep20Address: z.string().nullable(),
            upiId: z.string().nullable(),
        })
        .nullable()
        .openapi({
            description: "User bank details",
        }),
    stats: z.object({
        vipLevel: z.number().openapi({
            description: "User VIP level (0-10)",
            example: 5,
        }),
        totalCommission: z.number().openapi({
            description:
                "Settled team rebate commission (backward-compatible alias)",
            example: 5000.5,
        }),
        totalRebateCommission: z.number().openapi({
            description:
                "Total settled team rebate commission earned by the user",
            example: 5000.5,
        }),
        totalSalaryReceived: z.number().openapi({
            description:
                "Total manual, scheduled, and approved automatic salary credited to the user",
            example: 2500,
        }),
        totalRecharge: z.number().openapi({
            description: "Total recharge amount",
            example: 5000,
        }),
        directRecharge: z.number().openapi({
            description: "Direct downlinks (level 1) recharge",
            example: 3000,
        }),
        downlinkRecharge: z.number().openapi({
            description: "All downlinks (level 1-6) recharge",
            example: 8000,
        }),
        totalWithdraw: z.number().openapi({
            description: "Total withdraw amount",
            example: 2000,
        }),
        directWithdraw: z.number().openapi({
            description: "Direct downlinks (level 1) withdraw",
            example: 1500,
        }),
        downlinkWithdraw: z.number().openapi({
            description: "All downlinks (level 1-6) withdraw",
            example: 4000,
        }),
        totalBet: z.number().openapi({
            description: "Total bet amount",
            example: 10000,
        }),
        directBet: z.number().openapi({
            description: "Direct downlinks (level 1) bet",
            example: 6000,
        }),
        downlinkBet: z.number().openapi({
            description: "All downlinks (level 1-6) bet",
            example: 20000,
        }),
        allDownlinksCount: z.number().openapi({
            description: "Total downlinks count (level 1-6)",
            example: 45,
        }),
        directDownlinksCount: z.number().openapi({
            description: "Direct downlinks count (level 1 only)",
            example: 10,
        }),
        totalSubordinatesCount: z.number().openapi({
            description:
                "Total number of subordinates (1st level + all other levels)",
            example: 45,
        }),
        subordinatesWithFirstDepositCount: z.number().openapi({
            description: "Number of subordinates who made first deposit",
            example: 30,
        }),
        subordinatesWithBetsCount: z.number().openapi({
            description: "Number of subordinates who placed any bet",
            example: 35,
        }),
        userFirstDeposit: z.number().openapi({
            description: "First deposit amount of the user",
            example: 1000,
        }),
    }),
});

export const GetUserStatsResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    user: UserStatsSchema,
});

// Ban/Unban schema
export const BanUserBodySchema = z.object({
    reason: z.string().optional().openapi({
        description: "Reason for banning the user",
        example: "Violation of terms",
    }),
});

export const BanUserResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the action was successful",
        example: true,
    }),
    message: z.string().openapi({
        description: "Result message",
        example: "User banned successfully",
    }),
});

// Update balance schema
export const UpdateBalanceBodySchema = z.object({
    amount: z.number().openapi({
        description:
            "Amount to add (positive) or subtract (negative) from balance",
        example: 100,
    }),
    reason: z.string().optional().openapi({
        description: "Reason for balance update",
        example: "Bonus credit",
    }),
});

export const UpdateBalanceResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the action was successful",
        example: true,
    }),
    message: z.string().openapi({
        description: "Result message",
        example: "User balance updated successfully",
    }),
    newBalance: z.number().openapi({
        description: "New user balance",
        example: 1100.5,
    }),
});
