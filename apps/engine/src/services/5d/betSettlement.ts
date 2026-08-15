import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { WebSocketManager } from "@bcwin/websocket";
import { FiveDGameLogic } from "./gameLogic";
import type { FiveDBet, K3Bet } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import { CommissionCalculator } from "../commission/commissionCalculator";
import { processWinStreakForBet } from "@bcwin/activity-bonus";

const logger = new Logger("5d-bet-settlement");

interface FiveDResult {
    resultNumber: string;
    digitA: number;
    digitB: number;
    digitC: number;
    digitD: number;
    digitE: number;
    sum: number;
}

export class FiveDSettlement {
    /**
     * Calculate contract amount (after service fee)
     */
    // calculateContractAmount(betAmount: number): number {
    //     return FiveDGameLogic.calculateContractAmount(betAmount);
    // }

    /**
     * Calculate win amount for a bet
     */
    calculateWinAmount(bet: FiveDBet, result: FiveDResult): number {
        return FiveDGameLogic.calculateWinAmount(bet, result);
    }

    /**
     * Settle all bets for a specific period
     */
    // async settlePeriodBets(periodId: string): Promise<void> {
    //     try {
    //         // Get the period with result
    //         const period = await prisma.fiveDPeriod.findUnique({
    //             where: { id: periodId },
    //         });

    //         if (!period) {
    //             logger.error(`5D Period not found: ${periodId}`);
    //             return;
    //         }

    //         if (period.status !== "ENDED") {
    //             logger.warn(
    //                 `5D Period ${periodId} is not in ENDED status: ${period.status}`
    //             );
    //             return;
    //         }

    //         if (
    //             !period.resultNumber ||
    //             period.resultDigitA === null ||
    //             period.resultDigitB === null ||
    //             period.resultDigitC === null ||
    //             period.resultDigitD === null ||
    //             period.resultDigitE === null ||
    //             period.resultSum === null
    //         ) {
    //             logger.warn(
    //                 `5D Period ${periodId} does not have complete results yet`
    //             );
    //             return;
    //         }

    //         const result: FiveDResult = {
    //             resultNumber: period.resultNumber,
    //             digitA: period.resultDigitA,
    //             digitB: period.resultDigitB,
    //             digitC: period.resultDigitC,
    //             digitD: period.resultDigitD,
    //             digitE: period.resultDigitE,
    //             sum: period.resultSum,
    //         };

    //         // Get all unsettled bets for this period
    //         const bets = await prisma.fiveDBet.findMany({
    //             where: {
    //                 periodId,
    //                 status: "PENDING",
    //             },
    //             include: {
    //                 user: {
    //                     select: {
    //                         id: true,
    //                         balance: true,
    //                     },
    //                 },
    //                 fiveDBetResult: true,
    //             },
    //         });

    //         logger.debug(
    //             `Found ${bets.length} 5D bets to settle for period ${periodId}`
    //         );

    //         let totalWinnings = 0;
    //         let totalWinningBets = 0;
    //         let totalLosingBets = 0;

    //         await this.detectIllegalBets(bets);

    //         // Process each bet
    //         for (const bet of bets) {
    //             try {
    //                 // Skip if already has a result
    //                 if (bet.fiveDBetResult) {
    //                     logger.warn(
    //                         `5D Bet ${bet.id} already has a result, skipping`
    //                     );
    //                     continue;
    //                 }

    //                 const isWin = FiveDGameLogic.checkBetWin(bet, result);
    //                 const winAmount = isWin
    //                     ? this.calculateWinAmount(bet, result)
    //                     : 0;
    //                 const multiplier = isWin
    //                     ? FiveDGameLogic.getWinMultiplier(bet, result)
    //                     : null;

    //                 await this.processBetResult(
    //                     bet.id,
    //                     isWin,
    //                     winAmount,
    //                     multiplier
    //                 );

    //                 if (isWin) {
    //                     totalWinnings += winAmount;
    //                     totalWinningBets++;

    //                     // Process winnings (update balance)
    //                     await this.processWinnings(bet.id, winAmount);
    //                 } else {
    //                     totalLosingBets++;
    //                 }

    //                 await Cache.del(CacheKey.fiveDBets(bet.userId));

    //                 // Publish bet settlement notification
    //                 WebSocketManager.publishToUser(
    //                     bet.userId,
    //                     "bet-settlement",
    //                     {
    //                         status: isWin ? "WON" : "LOST",
    //                         periodId: bet.periodId,
    //                         betAmount: bet.betAmount,
    //                         contractAmount: bet.contractAmount,
    //                         ...(isWin && winAmount > 0 ? { winAmount } : {}),
    //                     }
    //                 );

    //                 // Calculate commission for this bet
            // ADR-0011: legacy commission disabled.
    //                 logger.debug(`Settled 5D bet ${bet.id}`, {
    //                     betDescription: FiveDGameLogic.getBetDescription(bet),
    //                     isWin,
    //                     winAmount,
    //                     multiplier,
    //                 });
    //             } catch (error) {
    //                 logger.error(`Error settling 5D bet ${bet.id}:`, error);
    //                 // Continue processing other bets
    //             }
    //         }

    //         logger.info(`Completed 5D bet settlement for period ${periodId}`, {
    //             periodNumber: period.periodNumber,
    //             resultDescription: FiveDGameLogic.getResultDescription(result),
    //             totalBets: bets.length,
    //             winningBets: totalWinningBets,
    //             losingBets: totalLosingBets,
    //             totalWinnings,
    //         });
    //     } catch (error) {
    //         logger.error(
    //             `Error settling 5D bets for period ${periodId}:`,
    //             error
    //         );
    //         throw error;
    //     }
    // }

    /**
     * Create bet result record and update bet status
     */
    private async processBetResult(
        betId: string,
        isWin: boolean,
        winAmount: number,
        multiplier: number | null
    ): Promise<void> {
        await prisma.$transaction(async (tx) => {
            // Create bet result
            await tx.fiveDBetResult.create({
                data: {
                    betId,
                    periodId: (await tx.fiveDBet.findUnique({
                        where: { id: betId },
                        select: { periodId: true },
                    }))!.periodId,
                    isWin,
                    winAmount,
                    multiplier,
                },
            });

            // Update bet status
            await tx.fiveDBet.update({
                where: { id: betId },
                data: {
                    status: isWin ? "WON" : "LOST",
                },
            });
        });
    }

    /**
     * Process winnings by updating user balance
     */
    async processWinnings(betId: string, winAmount: number): Promise<void> {
        if (winAmount <= 0) return;

        try {
            const bet = await prisma.fiveDBet.findUnique({
                where: { id: betId },
                include: {
                    user: {
                        select: {
                            id: true,
                            balance: true,
                        },
                    },
                },
            });

            if (!bet) {
                logger.error(
                    `5D Bet not found for winnings processing: ${betId}`
                );
                return;
            }

            // Update user balance in a transaction
            const updatedUser = await prisma.user.update({
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

            // Publish balance update via WebSocket
            WebSocketManager.publishToUser(bet.userId, "account-balance", {
                balance: updatedUser.balance,
            });

            // Publish winning notification
            // WebSocketManager.publishToUser(bet.userId, "5d-bet-win", {
            //     betId,
            //     winAmount,
            //     newBalance: updatedUser.balance,
            // });

            logger.debug(`Processed 5D winnings for bet ${betId}`, {
                userId: bet.userId,
                winAmount,
                newBalance: updatedUser.balance,
            });
        } catch (error) {
            logger.error(
                `Error processing 5D winnings for bet ${betId}:`,
                error
            );
            throw error;
        }
    }

    /**
     * Settle all periods that have results but unsettled bets
     */
    async settleAllEndedPeriodsWithResults(): Promise<void> {
        try {
            // Find periods with results that have unsettled bets
            const periodsToSettle = await prisma.fiveDPeriod.findMany({
                where: {
                    status: "ENDED",
                    resultNumber: {
                        not: null,
                    },
                    fiveDBets: {
                        some: {
                            status: "PENDING",
                        },
                    },
                },
                include: {
                    fiveDBets: {
                        where: {
                            status: "PENDING",
                        },
                    },
                },
                orderBy: { endTime: "asc" },
            });

            logger.debug(
                `Found ${periodsToSettle.length} 5D periods needing settlement`
            );

            // Collect all bets to settle with their period results
            const betsToSettle: Array<{
                bet: FiveDBet;
                result: FiveDResult;
            }> = [];

            // Detect illegal bets and collect bets for all periods
            for (const period of periodsToSettle) {
                if (
                    !period.resultNumber ||
                    period.resultDigitA === null ||
                    period.resultDigitB === null ||
                    period.resultDigitC === null ||
                    period.resultDigitD === null ||
                    period.resultDigitE === null ||
                    period.resultSum === null
                ) {
                    continue;
                }

                const result: FiveDResult = {
                    resultNumber: period.resultNumber,
                    digitA: period.resultDigitA,
                    digitB: period.resultDigitB,
                    digitC: period.resultDigitC,
                    digitD: period.resultDigitD,
                    digitE: period.resultDigitE,
                    sum: period.resultSum,
                };

                // Detect illegal bets for this period
                this.detectIllegalBets(period.fiveDBets);

                for (const bet of period.fiveDBets) {
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

            // Batch update all periods to RESOLVED (only if no pending bets remain)
            const periodsToResolve: string[] = [];
            for (const period of periodsToSettle) {
                const pendingBets = await prisma.fiveDBet.count({
                    where: {
                        periodId: period.id,
                        status: "PENDING",
                    },
                });

                if (pendingBets === 0) {
                    periodsToResolve.push(period.id);
                }
            }

            if (periodsToResolve.length > 0) {
                await prisma.fiveDPeriod.updateMany({
                    where: {
                        id: { in: periodsToResolve },
                    },
                    data: { status: "RESOLVED" },
                });
            }
        } catch (error) {
            logger.error("Error settling all 5D periods with results:", error);
        }
    }

    /**
     * Settle a single bet (used for parallel processing)
     */
    private async settleBet(
        bet: FiveDBet,
        result: FiveDResult
    ): Promise<{
        userId: string;
        periodId: string;
        betAmount: number;
        contractAmount: number;
        winAmount: number;
    }> {
        try {
            const isWin = FiveDGameLogic.checkBetWin(bet, result);
            const winAmount = isWin ? this.calculateWinAmount(bet, result) : 0;
            const multiplier = isWin
                ? FiveDGameLogic.getWinMultiplier(bet, result)
                : null;

            await this.processBetResult(bet.id, isWin, winAmount, multiplier);

            if (isWin) {
                // Process winnings (update balance)
                await this.processWinnings(bet.id, winAmount);
            }

            await Cache.invalidateUserGameCaches(
                bet.userId,
                CacheKey.fiveDBets(bet.userId)
            );

            // Calculate commission for this bet
            // ADR-0011: legacy commission disabled.
            logger.debug(`Settled 5D bet ${bet.id}`, {
                betDescription: FiveDGameLogic.getBetDescription(bet),
                isWin,
                winAmount,
                multiplier,
            });

            // Process win streak bonus
            await processWinStreakForBet(bet.userId, isWin, winAmount, "FIVEDEE");

            return {
                userId: bet.userId,
                periodId: bet.periodId,
                betAmount: bet.betAmount,
                contractAmount: bet.contractAmount,
                winAmount,
            };
        } catch (error) {
            logger.error(`Error settling 5D bet ${bet.id}:`, error);
            throw error;
        }
    }

    private async detectIllegalBets(bets: FiveDBet[]): Promise<void> {
        try {
            const betsByUser = new Map<string, FiveDBet[]>();
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
                ["LOW", "HIGH"],
                ["HIGH", "LOW"],
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
                                    betGame: "5D",
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
