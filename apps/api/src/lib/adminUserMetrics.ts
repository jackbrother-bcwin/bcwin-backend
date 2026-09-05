import { prisma } from "@bcwin/db";

const ID_CHUNK = 2000;
type Metric = { count: number; amount: number };
function emptyMetric(): Metric { return { count: 0, amount: 0 }; }

// Return one row per active user, with bounded query parameters.
// Omitted dates intentionally select lifetime statistics.
function mergeUserMetric(
    target: Map<string, Metric>,
    userId: string,
    amount: number,
    count: number
) {
    const current = target.get(userId) ?? emptyMetric();
    current.amount += amount;
    current.count += count;
    target.set(userId, current);
}

export async function moneyStatsByUser(
    kind: "deposit" | "withdrawal",
    userIds: string[],
    gte?: Date,
    lt?: Date
): Promise<Map<string, Metric>> {
    const result = new Map<string, Metric>();
    for (let i = 0; i < userIds.length; i += ID_CHUNK) {
        const ids = userIds.slice(i, i + ID_CHUNK);
        const where = {
            userId: { in: ids },
            status: "SUCCESS" as const,
            createdAt: { gte, lt },
        };
        const rows =
            kind === "deposit"
                ? await prisma.deposit.groupBy({
                      by: ["userId"],
                      where,
                      _sum: { amount: true },
                      _count: { _all: true },
                  })
                : await prisma.withdraw.groupBy({
                      by: ["userId"],
                      where,
                      _sum: { amount: true },
                      _count: { _all: true },
                  });

        for (const row of rows) {
            result.set(row.userId, {
                amount: row._sum.amount ?? 0,
                count: row._count._all,
            });
        }
    }
    return result;
}

export async function betStatsByUser(
    userIds: string[],
    gte?: Date,
    lt?: Date,
    excludeRolledBack = true
): Promise<Map<string, Metric>> {
    const result = new Map<string, Metric>();
    for (let i = 0; i < userIds.length; i += ID_CHUNK) {
        const ids = userIds.slice(i, i + ID_CHUNK);
        const where = { userId: { in: ids }, createdAt: { gte, lt } };
        const groups = await Promise.all([
            prisma.wingoBet.groupBy({
                by: ["userId"],
                where,
                _sum: { betAmount: true },
                _count: { _all: true },
            }),
            prisma.fiveDBet.groupBy({
                by: ["userId"],
                where,
                _sum: { betAmount: true },
                _count: { _all: true },
            }),
            prisma.k3Bet.groupBy({
                by: ["userId"],
                where,
                _sum: { betAmount: true },
                _count: { _all: true },
            }),
            prisma.motoBet.groupBy({
                by: ["userId"],
                where,
                _sum: { betAmount: true },
                _count: { _all: true },
            }),
            prisma.trxWingoBet.groupBy({
                by: ["userId"],
                where,
                _sum: { betAmount: true },
                _count: { _all: true },
            }),
            prisma.inoutBet.groupBy({
                by: ["userId"],
                where: { ...where, ...(excludeRolledBack ? { isRolledback: false } : {}) },
                _sum: { betAmount: true },
                _count: { _all: true },
            }),
        ]);

        for (const rows of groups) {
            for (const row of rows) {
                mergeUserMetric(
                    result,
                    row.userId,
                    row._sum.betAmount ?? 0,
                    row._count._all
                );
            }
        }
    }
    return result;
}
