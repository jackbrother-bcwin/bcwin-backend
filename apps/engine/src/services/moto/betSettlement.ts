import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import type { MotoBet } from "@bcwin/db";
import { MotoGameLogic } from "./gameLogic";
import { WebSocketManager } from "@bcwin/websocket";
import { Cache, CacheKey } from "@bcwin/cache";
import { CommissionCalculator } from "../commission/commissionCalculator";

const logger = new Logger("moto-bet-settlement");

interface RaceResults {
    firstPlace: number;
    secondPlace: number;
    thirdPlace: number;
}

export class MotoBetSettlement {
    // async settlePeriodBets(periodId: string): Promise<void> {
    //     try {
    //         const period = await prisma.motoPeriod.findUnique({
    //             where: { id: periodId },
    //             include: {
    //                 motoBets: {
    //                     where: {
    //                         status: "PENDING",
    //                     },
    //                 },
    //             },
    //         });

    //         if (!period) {
    //             logger.error(`Moto period not found: ${periodId}`);
    //             return;
    //         }

    //         if (
    //             period.firstPlace === null ||
    //             period.secondPlace === null ||
    //             period.thirdPlace === null
    //         ) {
    //             logger.error(
    //                 `Moto period ${periodId} does not have complete results`
    //             );
    //             return;
    //         }

    //         const results: RaceResults = {
    //             firstPlace: period.firstPlace,
    //             secondPlace: period.secondPlace,
    //             thirdPlace: period.thirdPlace,
    //         };

    //         logger.info(
    //             `Starting moto settlement for period ${
    //                 period.periodNumber
    //             }: ${MotoGameLogic.getResultDescription(results)}`
    //         );

    //         await this.detectIllegalBets(period.motoBets);

    //         for (const bet of period.motoBets) {
    //             await this.settleBet(bet, results);
    //         }

    //         logger.info(
    //             `Completed moto settlement for period ${period.periodNumber}`
    //         );
    //     } catch (error) {
    //         logger.error(
    //             `Error settling moto bets for period ${periodId}:`,
    //             error
    //         );
    //     }
    // }

    private async settleBet(
        bet: MotoBet,
        results: RaceResults
    ): Promise<{
        userId: string;
        periodId: string;
        betAmount: number;
        contractAmount: number;
        winAmount: number;
    }> {
        try {
            const isWin = MotoGameLogic.checkBetWin(bet, results);
            const winAmount = isWin
                ? MotoGameLogic.calculateWinAmount(bet, results)
                : 0;
            const multiplier = isWin
                ? MotoGameLogic.getWinMultiplier(bet, results)
                : null;

            await prisma.$transaction(async (tx) => {
                await tx.motoBetResult.create({
                    data: {
                        betId: bet.id,
                        periodId: bet.periodId,
                        isWin,
                        winAmount,
                        multiplier,
                    },
                });

                await tx.motoBet.update({
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
                CacheKey.motoBets(bet.userId)
            );

            // Calculate commission for this bet
            // ADR-0011: legacy commission disabled.
            if (isWin) {
                logger.info(
                    `Moto bet ${bet.id} won: ${MotoGameLogic.getBetDescription(
                        bet
                    )} -> ${winAmount} (${multiplier}x)`
                );
            }

            return {
                userId: bet.userId,
                periodId: bet.periodId,
                betAmount: bet.betAmount,
                contractAmount: bet.contractAmount,
                winAmount,
            };
        } catch (error) {
            logger.error(`Error settling moto bet ${bet.id}:`, error);
            throw error;
        }
    }

    async settleAllEndedPeriodsWithResults(): Promise<void> {
        try {
            const periodsToSettle = await prisma.motoPeriod.findMany({
                where: {
                    status: "ENDED",
                    firstPlace: { not: null },
                    secondPlace: { not: null },
                    thirdPlace: { not: null },
                },
                include: {
                    motoBets: {
                        where: {
                            status: "PENDING",
                        },
                    },
                },
                orderBy: { endTime: "asc" },
            });

            const periodsWithPendingBets = periodsToSettle.filter(
                (period) => period.motoBets.length > 0
            );

            // Collect all bets to settle with their period results
            const betsToSettle: Array<{
                bet: MotoBet;
                result: RaceResults;
            }> = [];

            // Detect illegal bets for all periods
            for (const period of periodsWithPendingBets) {
                if (
                    period.firstPlace === null ||
                    period.secondPlace === null ||
                    period.thirdPlace === null
                ) {
                    continue;
                }

                const results: RaceResults = {
                    firstPlace: period.firstPlace,
                    secondPlace: period.secondPlace,
                    thirdPlace: period.thirdPlace,
                };

                // Detect illegal bets for this period
                this.detectIllegalBets(period.motoBets);

                // Collect bets with their results
                for (const bet of period.motoBets) {
                    betsToSettle.push({ bet, result: results });
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
                await prisma.motoPeriod.updateMany({
                    where: {
                        id: { in: periodsToSettle.map((p) => p.id) },
                    },
                    data: { status: "RESOLVED" },
                });
            }
        } catch (error) {
            logger.error("Error settling ended moto periods:", error);
        }
    }

    async getSettlementStats(periodId: string): Promise<{
        totalBets: number;
        totalWinners: number;
        totalPayout: number;
        totalBetAmount: number;
    } | null> {
        try {
            const results = await prisma.motoBetResult.findMany({
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
                `Error getting moto settlement stats for period ${periodId}:`,
                error
            );
            return null;
        }
    }

    private async detectIllegalBets(bets: MotoBet[]): Promise<void> {
        try {
            const betsByUser = new Map<string, MotoBet[]>();
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
                                    betGame: "MOTO",
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
