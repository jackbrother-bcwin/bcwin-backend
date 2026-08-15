import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { WebSocketManager } from "@bcwin/websocket";

const logger = new Logger("win-streak-service");

export type WinStreakGame = "WINGO" | "K3" | "FIVEDEE" | "TRXWINGO";

/**
 * Call after every bet settles in Wingo, K3, 5D, or TRXWingo.
 *
 * Win  → increment streak + accumulate winAmount.
 * Loss → find highest qualifying rule (consecutiveWins ≤ streak),
 *         pay bonus, then reset streak + accumulator to 0.
 */
export async function processWinStreakForBet(
    userId: string,
    isWin: boolean,
    winAmount: number,
    game: WinStreakGame
): Promise<void> {
    try {
        if (isWin) {
            // ----------------------------------------------------------------
            // WIN: grow the streak
            // ----------------------------------------------------------------
            await prisma.userWinStreak.upsert({
                where: { userId },
                create: {
                    userId,
                    currentStreak: 1,
                    streakWinAmount: winAmount,
                    lastBetGame: game,
                    lastBetAt: new Date(),
                },
                update: {
                    currentStreak: { increment: 1 },
                    streakWinAmount: { increment: winAmount },
                    lastBetGame: game,
                    lastBetAt: new Date(),
                },
            });

            logger.debug(
                `Win streak incremented for user ${userId} (game: ${game}, winAmount: ${winAmount})`
            );
        } else {
            // ----------------------------------------------------------------
            // LOSS: check if any rule qualifies, pay bonus, then reset
            // ----------------------------------------------------------------

            // Read current streak state
            const streakData = await prisma.userWinStreak.findUnique({
                where: { userId },
                select: { currentStreak: true, streakWinAmount: true },
            });

            const currentStreak = streakData?.currentStreak ?? 0;
            const streakWinAmount = streakData?.streakWinAmount ?? 0;

            if (currentStreak >= 1) {
                // Find highest qualifying active rule
                const qualifyingRule = await prisma.winStreakRule.findFirst({
                    where: {
                        isActive: true,
                        consecutiveWins: { lte: currentStreak },
                    },
                    orderBy: { consecutiveWins: "desc" },
                });

                if (qualifyingRule && streakWinAmount > 0) {
                    const bonusAmount =
                        (streakWinAmount * qualifyingRule.bonusPercentage) / 100;

                    if (bonusAmount > 0) {
                        // Credit bonus to user balance + create activity bonus record
                        const updatedUser = await prisma.$transaction(
                            async (tx) => {
                                const updated = await tx.user.update({
                                    where: { id: userId },
                                    data: { balance: { increment: bonusAmount } },
                                    select: { balance: true },
                                });

                                await tx.activityBonus.create({
                                    data: {
                                        userId,
                                        type: "WIN_STREAK",
                                        status: "COLLECTED",
                                        amount: bonusAmount,
                                        metadata: {
                                            consecutiveWins: currentStreak,
                                            totalWinAmount: streakWinAmount,
                                            bonusPercentage:
                                                qualifyingRule.bonusPercentage,
                                            ruleId: qualifyingRule.id,
                                            ruleConsecutiveWins:
                                                qualifyingRule.consecutiveWins,
                                            game,
                                        },
                                    },
                                });

                                return updated;
                            }
                        );

                        // Notify user of new balance
                        WebSocketManager.publishToUser(
                            userId,
                            "account-balance",
                            { balance: updatedUser.balance }
                        );

                        logger.info(
                            `Win streak bonus paid to user ${userId}: ` +
                                `streak=${currentStreak}, winnings=${streakWinAmount}, ` +
                                `rule=${qualifyingRule.consecutiveWins}w @ ${qualifyingRule.bonusPercentage}%, ` +
                                `bonus=${bonusAmount}`
                        );
                    }
                }
            }

            // Reset streak regardless of whether a bonus was paid
            await prisma.userWinStreak.upsert({
                where: { userId },
                create: {
                    userId,
                    currentStreak: 0,
                    streakWinAmount: 0,
                    lastBetGame: game,
                    lastBetAt: new Date(),
                },
                update: {
                    currentStreak: 0,
                    streakWinAmount: 0,
                    lastBetGame: game,
                    lastBetAt: new Date(),
                },
            });

            logger.debug(
                `Win streak reset for user ${userId} after loss (game: ${game})`
            );
        }
    } catch (error) {
        logger.error(
            `Error processing win streak for user ${userId}:`,
            error
        );
    }
}
