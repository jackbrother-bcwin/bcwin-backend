import cron, { ScheduledTask } from "node-cron";
import Logger from "@bcwin/logger";
import { prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import { WebSocketManager } from "@bcwin/websocket";

const logger = new Logger("salary-scheduler");

function calculateNextPayment(fromDate: Date, frequency: string): Date {
    const next = new Date(fromDate);
    switch (frequency) {
        case "HOURLY":
            next.setHours(next.getHours() + 1);
            break;
        case "DAILY":
            next.setDate(next.getDate() + 1);
            break;
        case "WEEKLY":
            next.setDate(next.getDate() + 7);
            break;
        case "MONTHLY":
            next.setMonth(next.getMonth() + 1);
            break;
        case "ONE_TIME":
            // No next payment for one-time
            break;
    }
    return next;
}

function generateOrderId(): string {
    const date = new Date();
    const time =
        date.getUTCFullYear().toString() +
        String(date.getUTCMonth() + 1).padStart(2, "0") +
        String(date.getUTCDate()).padStart(2, "0");
    const random = Math.floor(
        10000000000000 + Math.random() * 90000000000000
    );
    return `${time}-${random}`;
}

export class SalaryScheduler {
    private task: ScheduledTask | null = null;
    private isTaskRunning = false;

    start(): void {
        logger.info("Starting Salary scheduler...");

        // Run every hour at minute 0
        this.task = cron.schedule(
            "0 * * * *",
            async () => {
                if (this.isTaskRunning) {
                    logger.warn(
                        "Previous salary processing is still running. Skipping."
                    );
                    return;
                }

                this.isTaskRunning = true;
                try {
                    await this.processDuePayments();
                } catch (error) {
                    logger.error("Error in salary processing:", error);
                } finally {
                    this.isTaskRunning = false;
                }
            },
            {
                timezone: "Asia/Kolkata",
            }
        );

        this.task.start();
        logger.info(
            "Salary scheduler started. Runs every hour at minute 0."
        );
    }

    stop(): void {
        logger.info("Stopping Salary scheduler...");
        if (this.task) {
            this.task.stop();
            this.task = null;
        }
        logger.info("Salary scheduler stopped.");
    }

    async processDuePayments(): Promise<void> {
        const now = new Date();

        // Query by isActive + nextPaymentAt
        const candidates = await prisma.salaryRule.findMany({
            where: {
                isActive: true,
                nextPaymentAt: { lte: now },
            },
        });

        const rulesToProcess = candidates.filter((r) =>
            r.maxPayments && r.maxPayments > 0 ? r.paidCount < r.maxPayments : true
        );

        if (rulesToProcess.length === 0) {
            logger.debug("No salary payments due.");
            return;
        }

        logger.info(`Processing ${rulesToProcess.length} salary payment(s)...`);

        for (const rule of rulesToProcess) {
            try {
                await prisma.$transaction(async (tx) => {
                    // Credit user balance
                    const updatedUser = await tx.user.update({
                        where: { id: rule.userId },
                        data: { balance: { increment: rule.amount } },
                        select: { balance: true },
                    });

                    // Record payment
                    await tx.salaryPayment.create({
                        data: {
                            user: { connect: { id: rule.userId } },
                            salaryRule: { connect: { id: rule.id } },
                            amount: rule.amount,
                            remark: rule.remark,
                        },
                    });

                    // Add to turnover if enabled
                    if (rule.addToTurnover) {
                        await tx.deposit.create({
                            data: {
                                userId: rule.userId,
                                amount: rule.amount,
                                method: "SALARY",
                                status: "SUCCESS",
                                orderId: generateOrderId(),
                            },
                        });
                    }

                    const newPaidCount = rule.paidCount + 1;
                    const isCompleted =
                        rule.maxPayments && rule.maxPayments > 0
                            ? newPaidCount >= rule.maxPayments
                            : false;

                    // Update rule
                    await tx.salaryRule.update({
                        where: { id: rule.id },
                        data: {
                            paidCount: newPaidCount,
                            isActive: isCompleted ? false : rule.isActive,
                            nextPaymentAt: isCompleted
                                ? rule.nextPaymentAt // keep as-is
                                : calculateNextPayment(
                                      rule.nextPaymentAt,
                                      rule.frequency
                                  ),
                        },
                    });

                    // Send balance update via websocket
                    WebSocketManager.publishToUser(
                        rule.userId,
                        "account-balance",
                        { balance: updatedUser.balance }
                    );

                    logger.info("Salary payment processed", {
                        ruleId: rule.id,
                        userId: rule.userId,
                        amount: rule.amount,
                        paidCount: newPaidCount,
                        maxPayments: rule.maxPayments,
                        remark: rule.remark,
                    });
                });

                // Invalidate user salary cache
                await Cache.del(CacheKey.userSalaryHistory(rule.userId));
            } catch (error) {
                logger.error(
                    `Failed to process salary for rule ${rule.id}:`,
                    error
                );
                // Continue processing other rules
            }
        }

        // Invalidate admin caches after batch processing
        await Promise.all([
            Cache.del(CacheKey.adminSalaryRules),
            Cache.del(CacheKey.adminSalaryStats),
        ]);

        logger.info("Salary processing cycle complete.");
    }
}
