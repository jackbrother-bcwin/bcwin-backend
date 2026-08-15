import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import type { K3Bet } from "@bcwin/db";
import { GameLogic } from "./gameLogic";
import { WebSocketManager } from "@bcwin/websocket";
import { Cache, CacheKey } from "@bcwin/cache";
import { CommissionCalculator } from "../commission/commissionCalculator";
import { processWinStreakForBet } from "@bcwin/activity-bonus";

const logger = new Logger("k3-bet-settlement");

interface PeriodResult {
    dice1: number;
    dice2: number;
    dice3: number;
    sum: number;
    isTriple: boolean;
    isDouble: boolean;
    isAllDifferent: boolean;
    isConsecutive: boolean;
    isBig: boolean;
    isSmall: boolean;
    isOdd: boolean;
    isEven: boolean;
}

export class BetSettlement {
    // async settlePeriodBets(periodId: string): Promise<void> {
    //     try {
    //         const period = await prisma.k3Period.findUnique({
    //             where: { id: periodId },
    //             include: {
    //                 k3Bets: {
    //                     where: {
    //                         status: "PENDING",
    //                     },
    //                 },
    //             },
    //         });

    //         if (!period) {
    //             logger.error(`K3 Period not found: ${periodId}`);
    //             return;
    //         }

    //         if (
    //             period.dice1 === null ||
    //             period.dice2 === null ||
    //             period.dice3 === null ||
    //             period.sum === null ||
    //             period.isTriple === null ||
    //             period.isDouble === null ||
    //             period.isAllDifferent === null ||
    //             period.isConsecutive === null ||
    //             period.isBig === null ||
    //             period.isSmall === null ||
    //             period.isOdd === null ||
    //             period.isEven === null
    //         ) {
    //             logger.error(
    //                 `K3 Period ${periodId} does not have complete results`
    //             );
    //             return;
    //         }

    //         const result: PeriodResult = {
    //             dice1: period.dice1,
    //             dice2: period.dice2,
    //             dice3: period.dice3,
    //             sum: period.sum,
    //             isTriple: period.isTriple,
    //             isDouble: period.isDouble,
    //             isAllDifferent: period.isAllDifferent,
    //             isConsecutive: period.isConsecutive,
    //             isBig: period.isBig,
    //             isSmall: period.isSmall,
    //             isOdd: period.isOdd,
    //             isEven: period.isEven,
    //         };

    //         logger.info(
    //             `Starting K3 settlement for period ${
    //                 period.periodNumber
    //             }: ${GameLogic.getResultDescription(result)}`
    //         );

    //         await this.detectIllegalBets(period.k3Bets);

    //         for (const bet of period.k3Bets) {
    //             await this.settleBet(bet, result);
    //         }

    //         logger.info(
    //             `Completed K3 settlement for period ${period.periodNumber}`
    //         );
    //     } catch (error) {
    //         logger.error(
    //             `Error settling K3 bets for period ${periodId}:`,
    //             error
    //         );
    //     }
    // }

    private async settleBet(
        bet: K3Bet,
        result: PeriodResult
    ): Promise<{
        userId: string;
        periodId: string;
        betAmount: number;
        contractAmount: number;
        winAmount: number;
    }> {
        try {
            const isWin = GameLogic.checkBetWin(bet, result);
            const winAmount = isWin
                ? GameLogic.calculateWinAmount(bet, result)
                : 0;
            const multiplier = isWin
                ? GameLogic.getWinMultiplier(bet, result)
                : null;

            await prisma.$transaction(async (tx) => {
                await tx.k3BetResult.create({
                    data: {
                        betId: bet.id,
                        periodId: bet.periodId,
                        isWin,
                        winAmount,
                        multiplier,
                    },
                });

                await tx.k3Bet.update({
                    where: { id: bet.id },
                    data: {
                        status: isWin ? "WON" : "LOST",
                    },
                });

                if (isWin && winAmount > 0) {
                    const updatedUser = await tx.user.update({
                        where: { id: bet.userId },
                        data: {
                            balance: {
                                increment: winAmount,
                            },
                        },
                        select: {
                            balance: true,
                        },
                    });

                    WebSocketManager.publishToUser(
                        bet.userId,
                        "account-balance",
                        {
                            balance: updatedUser.balance,
                        }
                    );
                }
            });

            await Cache.invalidateUserGameCaches(
                bet.userId,
                CacheKey.k3Bets(bet.userId)
            );

            // Calculate commission for this bet
            // ADR-0011: legacy commission disabled.
            if (isWin) {
                logger.info(
                    `K3 Bet ${bet.id} won: ${bet.betChoice} -> ${winAmount} (${multiplier}x)`
                );
            }

            // Process win streak bonus
            await processWinStreakForBet(bet.userId, isWin, winAmount, "K3");

            return {
                userId: bet.userId,
                periodId: bet.periodId,
                betAmount: bet.betAmount,
                contractAmount: bet.contractAmount,
                winAmount,
            };
        } catch (error) {
            logger.error(`Error settling K3 bet ${bet.id}:`, error);
            throw error;
        }
    }

    async settleAllEndedPeriodsWithResults(): Promise<void> {
        try {
            const periodsToSettle = await prisma.k3Period.findMany({
                where: {
                    status: "ENDED",
                    dice1: { not: null },
                    dice2: { not: null },
                    dice3: { not: null },
                    sum: { not: null },
                },
                include: {
                    k3Bets: {
                        where: {
                            status: "PENDING",
                        },
                    },
                },
                orderBy: { endTime: "asc" },
            });

            const periodsWithPendingBets = periodsToSettle.filter(
                (period) => period.k3Bets.length > 0
            );

            // Collect all bets to settle with their period results
            const betsToSettle: Array<{
                bet: K3Bet;
                result: PeriodResult;
            }> = [];

            // Detect illegal bets for all periods
            for (const period of periodsWithPendingBets) {
                if (
                    period.dice1 === null ||
                    period.dice2 === null ||
                    period.dice3 === null ||
                    period.sum === null ||
                    period.isTriple === null ||
                    period.isDouble === null ||
                    period.isAllDifferent === null ||
                    period.isConsecutive === null ||
                    period.isBig === null ||
                    period.isSmall === null ||
                    period.isOdd === null ||
                    period.isEven === null
                ) {
                    continue;
                }

                const result: PeriodResult = {
                    dice1: period.dice1,
                    dice2: period.dice2,
                    dice3: period.dice3,
                    sum: period.sum,
                    isTriple: period.isTriple,
                    isDouble: period.isDouble,
                    isAllDifferent: period.isAllDifferent,
                    isConsecutive: period.isConsecutive,
                    isBig: period.isBig,
                    isSmall: period.isSmall,
                    isOdd: period.isOdd,
                    isEven: period.isEven,
                };

                // Detect illegal bets for this period
                this.detectIllegalBets(period.k3Bets);

                // Collect bets with their results
                for (const bet of period.k3Bets) {
                    betsToSettle.push({ bet, result });
                }
            }

            // Settle all bets in parallel and collect settlement results
            const settlementResults = await Promise.all(
                betsToSettle.map(({ bet, result }) =>
                    this.settleBet(bet, result)
                )
            );

            // Group settlement results by userId and periodId
            const settlementByUserPeriod = new Map<
                string,
                {
                    userId: string;
                    periodId: string;
                    totalBetAmount: number;
                    totalContractAmount: number;
                    totalWinAmount: number;
                }
            >();

            for (const result of settlementResults) {
                const key = `${result.userId}:${result.periodId}`;
                if (!settlementByUserPeriod.has(key)) {
                    settlementByUserPeriod.set(key, {
                        userId: result.userId,
                        periodId: result.periodId,
                        totalBetAmount: 0,
                        totalContractAmount: 0,
                        totalWinAmount: 0,
                    });
                }

                const settlement = settlementByUserPeriod.get(key)!;
                settlement.totalBetAmount += result.betAmount;
                settlement.totalContractAmount += result.contractAmount;
                settlement.totalWinAmount += result.winAmount;
            }

            // Send cumulative bet settlement notifications (one per user per period)
            for (const settlement of settlementByUserPeriod.values()) {
                WebSocketManager.publishToUser(
                    settlement.userId,
                    "bet-settlement",
                    {
                        status:
                            settlement.totalBetAmount >
                            settlement.totalWinAmount
                                ? "LOST"
                                : "WON",
                        periodId: settlement.periodId,
                        betAmount: settlement.totalBetAmount,
                        contractAmount: settlement.totalContractAmount,
                        ...(settlement.totalWinAmount > 0
                            ? { winAmount: settlement.totalWinAmount }
                            : {}),
                    }
                );
            }

            // Batch update all periods to RESOLVED
            if (periodsToSettle.length > 0) {
                await prisma.k3Period.updateMany({
                    where: {
                        id: { in: periodsToSettle.map((p) => p.id) },
                    },
                    data: { status: "RESOLVED" },
                });
            }
        } catch (error) {
            logger.error("Error settling K3 ended periods:", error);
        }
    }

    async getSettlementStats(periodId: string): Promise<{
        totalBets: number;
        totalWinners: number;
        totalPayout: number;
        totalBetAmount: number;
    } | null> {
        try {
            const results = await prisma.k3BetResult.findMany({
                where: { periodId },
                include: {
                    bet: {
                        select: {
                            betAmount: true,
                        },
                    },
                },
            });

            const totalBets = results.length;
            const totalWinners = results.filter((r) => r.isWin).length;
            const totalPayout = results.reduce(
                (sum, r) => sum + r.winAmount,
                0
            );
            const totalBetAmount = results.reduce(
                (sum, r) => sum + r.bet.betAmount,
                0
            );

            return {
                totalBets,
                totalWinners,
                totalPayout,
                totalBetAmount,
            };
        } catch (error) {
            logger.error(
                `Error getting K3 settlement stats for period ${periodId}:`,
                error
            );
            return null;
        }
    }

    private async detectIllegalBets(bets: K3Bet[]): Promise<void> {
        try {
            const betsByUser = new Map<string, K3Bet[]>();
            for (const bet of bets) {
                if (!betsByUser.has(bet.userId)) {
                    betsByUser.set(bet.userId, []);
                }
                betsByUser.get(bet.userId)!.push(bet);
            }

            const illegalBetsData: {
                userId: string;
                betAmount: number;
                betGame: string;
                betType: string;
            }[] = [];

            const oppositePairs = [
                ["BIG", "SMALL"],
                ["SMALL", "BIG"],
                ["ODD", "EVEN"],
                ["EVEN", "ODD"],
            ];

            for (const [userId, userBets] of betsByUser) {
                if (userBets.length < 2) continue;

                // We want to find pairs of bets that are opposite and have the same amount
                // To avoid duplicates, we can iterate indices
                // const matchedIndices = new Set<number>();

                for (let i = 0; i < userBets.length; i++) {
                    for (let j = i + 1; j < userBets.length; j++) {
                        const bet1 = userBets[i];
                        const bet2 = userBets[j];

                        if (bet1.betAmount === bet2.betAmount) {
                            const isOpposite = oppositePairs.some(
                                (pair) =>
                                    pair[0] === bet1.betChoice &&
                                    pair[1] === bet2.betChoice
                            );

                            if (isOpposite) {
                                illegalBetsData.push({
                                    userId,
                                    betAmount: bet1.betAmount,
                                    betGame: "K3",
                                    betType: `${bet1.betChoice}_${bet2.betChoice}`,
                                });
                            }
                        }
                    }
                }
            }

            if (illegalBetsData.length > 0) {
                await prisma.illegalBet.createMany({
                    data: illegalBetsData,
                });

                const config = await prisma.config.findFirst();
                const penaltyFactor = config?.illegalBetPenaltyFactor ?? 3.0;
                const affectedUserIds = [
                    ...new Set(illegalBetsData.map((b) => b.userId)),
                ];

                await prisma.user.updateMany({
                    where: {
                        id: { in: affectedUserIds },
                        hasIllegalBetPenalty: false,
                    },
                    data: {
                        hasIllegalBetPenalty: true,
                        illegalBetPenaltyFactor: penaltyFactor,
                    },
                });

                logger.info(
                    `Detected and recorded ${illegalBetsData.length} illegal bets for users ${affectedUserIds.join(", ")}, assigned ${penaltyFactor}x penalty`
                );
            }
        } catch (error) {
            logger.error("Error detecting illegal bets:", error);
        }
    }
}
