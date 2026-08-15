import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { apiError, CommonResponses } from "@/lib/utils";
import { HTTP_STATUS } from "@/lib/http";
import { authCookie } from "@/schemas";
import { Cache, CacheKey } from "@bcwin/cache";
import { getTeamMembers } from "../users/helpers";

const logger = new Logger("admin-agent-performance");

// Level performance schema
const levelPerformanceSchema = z.object({
    users: z.number().openapi({
        description: "Number of users at this level",
        example: 25,
    }),
    totalDeposits: z.number().openapi({
        description: "Total deposits at this level",
        example: 50000.0,
    }),
    totalBetAmount: z.number().openapi({
        description: "Total bet amount at this level",
        example: 45000.0,
    }),
    totalWinAmount: z.number().openapi({
        description: "Total win amount at this level",
        example: 40000.0,
    }),
    profitLoss: z.number().openapi({
        description: "Profit/Loss at this level",
        example: 5000.0,
    }),
});

// Network level distribution schema
const networkLevelDistributionSchema = z.object({
    level: z.number().openapi({
        description: "Network level (1-6)",
        example: 1,
    }),
    userCount: z.number().openapi({
        description: "Number of users in this level",
        example: 25,
    }),
    performance: levelPerformanceSchema,
});

// Network performance metrics schema
const networkPerformanceMetricsSchema = z.object({
    winRate: z.number().openapi({
        description: "Overall win rate percentage",
        example: 65.5,
    }),
    averageBet: z.number().openapi({
        description: "Average bet size",
        example: 50.0,
    }),
    efficiency: z.number().openapi({
        description: "Efficiency percentage (win amount / bet amount * 100)",
        example: 88.9,
    }),
});

// Financial distribution schema
const financialDistributionSchema = z.object({
    deposit: z.number().openapi({
        description: "Total deposits from all users under the agent",
        example: 50000.0,
    }),
    withdrawal: z.number().openapi({
        description: "Total withdrawals from all users under the agent",
        example: 30000.0,
    }),
    bet: z.number().openapi({
        description: "Total bet amount from all users under the agent",
        example: 45000.0,
    }),
    win: z.number().openapi({
        description: "Total win amount from all users under the agent",
        example: 40000.0,
    }),
    commission: z.number().openapi({
        description: "Total commission earned from all users under the agent",
        example: 5000.0,
    }),
});

// Card items schema
const cardItemsSchema = z.object({
    totalNetworkSizeFirstLevel: z.number().openapi({
        description: "Total network size in first level (direct downlines)",
        example: 25,
    }),
    totalDeposits: z.object({
        agentDeposits: z.number().openapi({
            description: "Agent's own deposits",
            example: 10000.0,
        }),
        allDownlineDeposits: z.number().openapi({
            description: "All downline deposits (all levels)",
            example: 50000.0,
        }),
        total: z.number().openapi({
            description: "Total deposits (agent + all downlines)",
            example: 60000.0,
        }),
        retentionRate: z.number().openapi({
            description: "Retention rate percentage",
            example: 75.5,
        }),
    }),
    netProfit: z.object({
        amount: z.number().openapi({
            description: "Net profit amount",
            example: 15000.0,
        }),
        winRate: z.number().openapi({
            description: "Win rate percentage",
            example: 65.5,
        }),
    }),
    commissionEarned: z.object({
        amount: z.number().openapi({
            description: "Total commission earned",
            example: 5000.0,
        }),
        totalBets: z.number().openapi({
            description: "Total number of bets",
            example: 1000,
        }),
    }),
});

// Main agent performance response schema
const agentPerformanceResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    data: z.object({
        agentId: z.string().openapi({
            description: "Agent ID",
            example: "uuid-123",
        }),
        cardItems: cardItemsSchema,
        networkLevelDistribution: z.array(networkLevelDistributionSchema),
        networkPerformanceMetrics: networkPerformanceMetricsSchema,
        financialDistribution: financialDistributionSchema,
    }),
});

const getAgentPerformanceRoute = createRoute({
    method: "get",
    path: "/:identifier/performance",
    tags: ["admin"],
    summary: "Get agent performance details",
    description:
        "Get comprehensive performance metrics for a single agent including network size, deposits, retention rate, net profit, commission, and level-wise breakdown. Can be queried by agent ID or serialNumber.",
    request: {
        params: z.object({
            identifier: z.string().openapi({
                description: "Agent ID (UUID) or serialNumber (number)",
                example: "uuid-123",
            }),
        }),
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: agentPerformanceResponseSchema,
                },
            },
            description: "Agent performance data retrieved successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

type AgentPerformanceData = z.infer<
    typeof agentPerformanceResponseSchema
>["data"];

// Helper function to calculate level-wise performance
async function calculateLevelWisePerformance(
    level: number,
    userIds: string[]
): Promise<z.infer<typeof levelPerformanceSchema>> {
    if (userIds.length === 0) {
        return {
            users: 0,
            totalDeposits: 0,
            totalBetAmount: 0,
            totalWinAmount: 0,
            profitLoss: 0,
        };
    }

    const [
        deposits,
        wingoBets,
        fiveDBets,
        k3Bets,
        motoBets,
        trxWingoBets,
        wingoWins,
        fiveDWins,
        k3Wins,
        motoWins,
        trxWingoWins,
    ] = await Promise.all([
        prisma.deposit.aggregate({
            where: {
                userId: { in: userIds },
                status: "SUCCESS",
            },
            _sum: { amount: true },
        }),
        prisma.wingoBet.aggregate({
            where: { userId: { in: userIds } },
            _sum: { betAmount: true },
        }),
        prisma.fiveDBet.aggregate({
            where: { userId: { in: userIds } },
            _sum: { betAmount: true },
        }),
        prisma.k3Bet.aggregate({
            where: { userId: { in: userIds } },
            _sum: { betAmount: true },
        }),
        prisma.motoBet.aggregate({
            where: { userId: { in: userIds } },
            _sum: { betAmount: true },
        }),
        prisma.trxWingoBet.aggregate({
            where: { userId: { in: userIds } },
            _sum: { betAmount: true },
        }),
        prisma.wingoBetResult.aggregate({
            where: {
                bet: {
                    userId: { in: userIds },
                },
                isWin: true,
            },
            _sum: { winAmount: true },
        }),
        prisma.fiveDBetResult.aggregate({
            where: {
                bet: {
                    userId: { in: userIds },
                },
                isWin: true,
            },
            _sum: { winAmount: true },
        }),
        prisma.k3BetResult.aggregate({
            where: {
                bet: {
                    userId: { in: userIds },
                },
                isWin: true,
            },
            _sum: { winAmount: true },
        }),
        prisma.motoBetResult.aggregate({
            where: {
                bet: {
                    userId: { in: userIds },
                },
                isWin: true,
            },
            _sum: { winAmount: true },
        }),
        prisma.trxWingoBetResult.aggregate({
            where: {
                bet: {
                    userId: { in: userIds },
                },
                isWin: true,
            },
            _sum: { winAmount: true },
        }),
    ]);

    const totalDeposits = deposits._sum.amount ?? 0;
    const totalBetAmount =
        (wingoBets._sum.betAmount ?? 0) +
        (fiveDBets._sum.betAmount ?? 0) +
        (k3Bets._sum.betAmount ?? 0) +
        (motoBets._sum.betAmount ?? 0) +
        (trxWingoBets._sum.betAmount ?? 0);
    const totalWinAmount =
        (wingoWins._sum?.winAmount ?? 0) +
        (fiveDWins._sum?.winAmount ?? 0) +
        (k3Wins._sum?.winAmount ?? 0) +
        (motoWins._sum?.winAmount ?? 0) +
        (trxWingoWins._sum?.winAmount ?? 0);
    const profitLoss = totalBetAmount - totalWinAmount;

    return {
        users: userIds.length,
        totalDeposits,
        totalBetAmount,
        totalWinAmount,
        profitLoss,
    };
}

export const agentPerformanceRoutes = (app: OpenAPIHono) => {
    app.openapi(getAgentPerformanceRoute, async (c) => {
        try {
            const { identifier } = c.req.valid("param");

            // Determine if identifier is a serialNumber (numeric) or id (UUID)
            const isSerialNumber = /^\d+$/.test(identifier);
            const whereCondition = isSerialNumber
                ? {
                      serialNumber: parseInt(identifier, 10),
                      role: "AGENT" as const,
                  }
                : { id: identifier, role: "AGENT" as const };

            // Verify agent exists and is an agent
            const agent = await prisma.user.findFirst({
                where: whereCondition,
                select: {
                    id: true,
                    role: true,
                    isDemo: true,
                },
            });

            if (!agent) {
                return apiError(c, "Agent not found", HTTP_STATUS.BAD_REQUEST);
            }

            if (agent.role !== "AGENT") {
                return apiError(
                    c,
                    "User is not an agent",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            // Use the actual agent ID for cache and further operations
            const agentId = agent.id;

            if (agent.isDemo) {
                const result: AgentPerformanceData = {
                    agentId: agentId,
                    cardItems: {
                        totalNetworkSizeFirstLevel: 0,
                        totalDeposits: {
                            agentDeposits: 0,
                            allDownlineDeposits: 0,
                            total: 0,
                            retentionRate: 0,
                        },
                        netProfit: {
                            amount: 0,
                            winRate: 0,
                        },
                        commissionEarned: {
                            amount: 0,
                            totalBets: 0,
                        },
                    },
                    networkLevelDistribution: Array.from({ length: 6 }, (_, i) => ({
                        level: i + 1,
                        userCount: 0,
                        performance: {
                            users: 0,
                            totalDeposits: 0,
                            totalBetAmount: 0,
                            totalWinAmount: 0,
                            profitLoss: 0,
                        },
                    })),
                    networkPerformanceMetrics: {
                        winRate: 0,
                        averageBet: 0,
                        efficiency: 0,
                    },
                    financialDistribution: {
                        deposit: 0,
                        withdrawal: 0,
                        bet: 0,
                        win: 0,
                        commission: 0,
                    },
                };

                return c.json(
                    {
                        success: true,
                        data: result,
                    },
                    HTTP_STATUS.OK
                );
            }

            // Check cache
            const cacheKey = CacheKey.adminAgentPerformance(agentId);
            const cachedData = await Cache.get<AgentPerformanceData>(cacheKey);

            if (cachedData) {
                return c.json(
                    {
                        success: true,
                        data: cachedData,
                    },
                    HTTP_STATUS.OK
                );
            }

            // Get team members (all levels)
            const teamMembers = await getTeamMembers(agentId, 6);

            // Organize by level
            const usersByLevel: Record<number, string[]> = {};
            for (let level = 1; level <= 6; level++) {
                usersByLevel[level] = teamMembers
                    .filter((m) => m.layer === level)
                    .map((m) => m.user.id);
            }

            const level1UserIds = usersByLevel[1];
            const allDownlineIds = teamMembers.map((m) => m.user.id);

            // Calculate agent's own stats
            const [
                agentDeposits,
                agentWingoBets,
                agentFiveDBets,
                agentK3Bets,
                agentMotoBets,
                agentTrxWingoBets,
                agentWingoWins,
                agentFiveDWins,
                agentK3Wins,
                agentMotoWins,
                agentTrxWingoWins,
            ] = await Promise.all([
                prisma.deposit.aggregate({
                    where: { userId: agentId, status: "SUCCESS" },
                    _sum: { amount: true },
                }),
                prisma.wingoBet.aggregate({
                    where: { userId: agentId },
                    _sum: { betAmount: true },
                }),
                prisma.fiveDBet.aggregate({
                    where: { userId: agentId },
                    _sum: { betAmount: true },
                }),
                prisma.k3Bet.aggregate({
                    where: { userId: agentId },
                    _sum: { betAmount: true },
                }),
                prisma.motoBet.aggregate({
                    where: { userId: agentId },
                    _sum: { betAmount: true },
                }),
                prisma.trxWingoBet.aggregate({
                    where: { userId: agentId },
                    _sum: { betAmount: true },
                }),
                prisma.wingoBetResult.aggregate({
                    where: {
                        bet: { userId: agentId },
                        isWin: true,
                    },
                    _sum: { winAmount: true },
                }),
                prisma.fiveDBetResult.aggregate({
                    where: {
                        bet: { userId: agentId },
                        isWin: true,
                    },
                    _sum: { winAmount: true },
                }),
                prisma.k3BetResult.aggregate({
                    where: {
                        bet: { userId: agentId },
                        isWin: true,
                    },
                    _sum: { winAmount: true },
                }),
                prisma.motoBetResult.aggregate({
                    where: {
                        bet: { userId: agentId },
                        isWin: true,
                    },
                    _sum: { winAmount: true },
                }),
                prisma.trxWingoBetResult.aggregate({
                    where: {
                        bet: { userId: agentId },
                        isWin: true,
                    },
                    _sum: { winAmount: true },
                }),
            ]);

            const agentDepositAmount = agentDeposits._sum.amount ?? 0;

            // Calculate all downline deposits and withdrawals
            const [allDownlineDeposits, allDownlineWithdrawals] =
                await Promise.all([
                    prisma.deposit.aggregate({
                        where: {
                            userId: { in: allDownlineIds },
                            status: "SUCCESS",
                        },
                        _sum: { amount: true },
                    }),
                    prisma.withdraw.aggregate({
                        where: {
                            userId: { in: allDownlineIds },
                            status: "SUCCESS",
                        },
                        _sum: { amount: true },
                    }),
                ]);

            const allDownlineDepositAmount =
                allDownlineDeposits._sum.amount ?? 0;
            const allDownlineWithdrawalAmount =
                allDownlineWithdrawals._sum.amount ?? 0;
            const totalDeposits = agentDepositAmount + allDownlineDepositAmount;

            // Calculate retention rate (active users / total users)
            // Active users = users who have placed bets in the last 7 days
            const oneWeekAgo = new Date();
            oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

            const activeUsers = await prisma.user.count({
                where: {
                    id: { in: allDownlineIds },
                    OR: [
                        {
                            wingoBets: {
                                some: { createdAt: { gte: oneWeekAgo } },
                            },
                        },
                        {
                            fiveDBets: {
                                some: { createdAt: { gte: oneWeekAgo } },
                            },
                        },
                        {
                            k3Bets: {
                                some: { createdAt: { gte: oneWeekAgo } },
                            },
                        },
                        {
                            motoBets: {
                                some: { createdAt: { gte: oneWeekAgo } },
                            },
                        },
                        {
                            trxwingoBets: {
                                some: { createdAt: { gte: oneWeekAgo } },
                            },
                        },
                    ],
                },
            });

            const retentionRate =
                allDownlineIds.length > 0
                    ? (activeUsers / allDownlineIds.length) * 100
                    : 0;

            // Calculate all network bets and wins
            const [
                networkWingoBets,
                networkFiveDBets,
                networkK3Bets,
                networkMotoBets,
                networkTrxWingoBets,
                networkWingoWins,
                networkFiveDWins,
                networkK3Wins,
                networkMotoWins,
                networkTrxWingoWins,
            ] = await Promise.all([
                prisma.wingoBet.aggregate({
                    where: { userId: { in: allDownlineIds } },
                    _sum: { betAmount: true },
                    _count: true,
                }),
                prisma.fiveDBet.aggregate({
                    where: { userId: { in: allDownlineIds } },
                    _sum: { betAmount: true },
                    _count: true,
                }),
                prisma.k3Bet.aggregate({
                    where: { userId: { in: allDownlineIds } },
                    _sum: { betAmount: true },
                    _count: true,
                }),
                prisma.motoBet.aggregate({
                    where: { userId: { in: allDownlineIds } },
                    _sum: { betAmount: true },
                    _count: true,
                }),
                prisma.trxWingoBet.aggregate({
                    where: { userId: { in: allDownlineIds } },
                    _sum: { betAmount: true },
                    _count: true,
                }),
                prisma.wingoBetResult.aggregate({
                    where: {
                        bet: { userId: { in: allDownlineIds } },
                        isWin: true,
                    },
                    _sum: { winAmount: true },
                }),
                prisma.fiveDBetResult.aggregate({
                    where: {
                        bet: { userId: { in: allDownlineIds } },
                        isWin: true,
                    },
                    _sum: { winAmount: true },
                }),
                prisma.k3BetResult.aggregate({
                    where: {
                        bet: { userId: { in: allDownlineIds } },
                        isWin: true,
                    },
                    _sum: { winAmount: true },
                }),
                prisma.motoBetResult.aggregate({
                    where: {
                        bet: { userId: { in: allDownlineIds } },
                        isWin: true,
                    },
                    _sum: { winAmount: true },
                }),
                prisma.trxWingoBetResult.aggregate({
                    where: {
                        bet: { userId: { in: allDownlineIds } },
                        isWin: true,
                    },
                    _sum: { winAmount: true },
                }),
            ]);

            const totalNetworkBetAmount =
                (networkWingoBets._sum.betAmount ?? 0) +
                (networkFiveDBets._sum.betAmount ?? 0) +
                (networkK3Bets._sum.betAmount ?? 0) +
                (networkMotoBets._sum.betAmount ?? 0) +
                (networkTrxWingoBets._sum.betAmount ?? 0);

            const totalNetworkWinAmount =
                (networkWingoWins._sum?.winAmount ?? 0) +
                (networkFiveDWins._sum?.winAmount ?? 0) +
                (networkK3Wins._sum?.winAmount ?? 0) +
                (networkMotoWins._sum?.winAmount ?? 0) +
                (networkTrxWingoWins._sum?.winAmount ?? 0);

            const totalNetworkBets =
                (networkWingoBets._count ?? 0) +
                (networkFiveDBets._count ?? 0) +
                (networkK3Bets._count ?? 0) +
                (networkMotoBets._count ?? 0) +
                (networkTrxWingoBets._count ?? 0);

            // Calculate winning bets count for win rate
            const winningBetsCount = await Promise.all([
                prisma.wingoBetResult.count({
                    where: {
                        bet: { userId: { in: allDownlineIds } },
                        isWin: true,
                    },
                }),
                prisma.fiveDBetResult.count({
                    where: {
                        bet: { userId: { in: allDownlineIds } },
                        isWin: true,
                    },
                }),
                prisma.k3BetResult.count({
                    where: {
                        bet: { userId: { in: allDownlineIds } },
                        isWin: true,
                    },
                }),
                prisma.motoBetResult.count({
                    where: {
                        bet: { userId: { in: allDownlineIds } },
                        isWin: true,
                    },
                }),
                prisma.trxWingoBetResult.count({
                    where: {
                        bet: { userId: { in: allDownlineIds } },
                        isWin: true,
                    },
                }),
            ]);

            const totalWinningBets = winningBetsCount.reduce(
                (sum, count) => sum + count,
                0
            );

            const networkWinRate =
                totalNetworkBets > 0
                    ? (totalWinningBets / totalNetworkBets) * 100
                    : 0;

            const netProfit = totalNetworkBetAmount - totalNetworkWinAmount;

            // Calculate commission earned
            const commissionData = await prisma.commission.aggregate({
                where: { userId: agentId },
                _sum: { commissionAmount: true },
            });

            const commissionEarned = commissionData._sum.commissionAmount ?? 0;

            // Get total number of bets that generated commission
            const commissionBets = await prisma.commission.count({
                where: { userId: agentId },
            });

            // Calculate performance for all levels
            const levelPerformances = await Promise.all(
                Array.from({ length: 6 }, (_, i) => {
                    const level = i + 1;
                    return calculateLevelWisePerformance(
                        level,
                        usersByLevel[level] || []
                    );
                })
            );

            // Network level distribution with performance (always include all 6 levels)
            const networkLevelDistribution = Array.from(
                { length: 6 },
                (_, i) => {
                    const level = i + 1;
                    return {
                        level,
                        userCount: usersByLevel[level]?.length || 0,
                        performance: levelPerformances[i],
                    };
                }
            );

            // Network performance metrics
            const averageBet =
                totalNetworkBets > 0
                    ? totalNetworkBetAmount / totalNetworkBets
                    : 0;
            const efficiency =
                totalNetworkBetAmount > 0
                    ? (totalNetworkWinAmount / totalNetworkBetAmount) * 100
                    : 0;

            const result: AgentPerformanceData = {
                agentId: agentId,
                cardItems: {
                    totalNetworkSizeFirstLevel: level1UserIds.length,
                    totalDeposits: {
                        agentDeposits: agentDepositAmount,
                        allDownlineDeposits: allDownlineDepositAmount,
                        total: totalDeposits,
                        retentionRate: Number(retentionRate.toFixed(2)),
                    },
                    netProfit: {
                        amount: netProfit,
                        winRate: Number(networkWinRate.toFixed(2)),
                    },
                    commissionEarned: {
                        amount: commissionEarned,
                        totalBets: commissionBets,
                    },
                },
                networkLevelDistribution,
                networkPerformanceMetrics: {
                    winRate: Number(networkWinRate.toFixed(2)),
                    averageBet: Number(averageBet.toFixed(2)),
                    efficiency: Number(efficiency.toFixed(2)),
                },
                financialDistribution: {
                    deposit: allDownlineDepositAmount,
                    withdrawal: allDownlineWithdrawalAmount,
                    bet: totalNetworkBetAmount,
                    win: totalNetworkWinAmount,
                    commission: commissionEarned,
                },
            };

            // Cache for 5 minutes
            await Cache.set(cacheKey, result, 60 * 5);

            return c.json(
                {
                    success: true,
                    data: result,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error(error);
            return apiError(
                c,
                "Internal server error",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
