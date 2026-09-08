import { Prisma } from "@bcwin/db";

/** Caller holds the user's row lock. Receipts prevent reusing a stake on later reads. */
export async function allocateUserWagers(tx: Prisma.TransactionClient, userId: string) {
    const requirements = await tx.wagerRequirement.findMany({
        where: { userId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (!requirements.some((r) => !r.isCleared)) return requirements;
    const args = {
        where: { userId, createdAt: { gte: requirements[0].createdAt } },
        select: { id: true, betAmount: true, createdAt: true },
    };
    const sources = await Promise.all([
        tx.wingoBet.findMany(args), tx.trxWingoBet.findMany(args),
        tx.k3Bet.findMany(args), tx.fiveDBet.findMany(args), tx.motoBet.findMany(args),
    ]);
    const bets = sources.flatMap((rows, game) => rows.map((b) => ({
        key: `${game}:${b.id}`, createdAt: b.createdAt, available: b.betAmount,
    }))).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.key.localeCompare(b.key));
    const receipts = await tx.wagerAllocation.findMany({ where: { userId } });
    const byKey = new Map(bets.map((b) => [b.key, b]));
    for (const receipt of receipts) {
        const bet = byKey.get(receipt.betKey);
        if (bet) bet.available = Math.max(0, bet.available - receipt.amount);
    }
    const additions = new Map<string, { requirementId: string; betKey: string; amount: number }>();
    function consume(requirementId: string, bet: typeof bets[number], amount: number) {
        bet.available = Math.max(0, bet.available - amount);
        const key = `${requirementId}:${bet.key}`;
        const row = additions.get(key) ?? { requirementId, betKey: bet.key, amount: 0 };
        row.amount += amount;
        additions.set(key, row);
    }

    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.wagerAccountingInitialized) {
        // Reserve historical credited stakes before new allocation. Preserve already
        // cleared legacy requirements, even if the old calculator double-counted them.
        for (const req of requirements) {
            let remaining = req.wagerCleared;
            for (const bet of bets) {
                if (remaining <= 0) break;
                if (bet.createdAt < req.createdAt || bet.available <= 0) continue;
                const amount = Math.min(remaining, bet.available);
                consume(req.id, bet, amount);
                remaining -= amount;
            }
        }
        await tx.user.update({ where: { id: userId }, data: { wagerAccountingInitialized: true } });
    }

    const changed = new Set<string>();
    for (const bet of bets) {
        if (bet.available <= 0) continue;
        for (const req of requirements) {
            if (bet.available <= 0) break;
            if (req.createdAt > bet.createdAt) break;
            if (req.isCleared) continue;
            const amount = Math.min(bet.available, Math.max(0, req.requiredWager - req.wagerCleared));
            if (amount <= 0) continue;
            consume(req.id, bet, amount);
            req.wagerCleared += amount;
            changed.add(req.id);
        }
    }
    for (const req of requirements) {
        if (!req.isCleared && req.wagerCleared >= req.requiredWager) {
            req.isCleared = true;
            changed.add(req.id);
        }
        if (changed.has(req.id)) await tx.wagerRequirement.update({
            where: { id: req.id }, data: { wagerCleared: req.wagerCleared, isCleared: req.isCleared },
        });
    }
    const rows = [...additions.values()];
    for (let i = 0; i < rows.length; i += 500) {
        const values = rows.slice(i, i + 500).map((r) => Prisma.sql`(${crypto.randomUUID()}, ${userId}, ${r.requirementId}, ${r.betKey}, ${r.amount})`);
        await tx.$executeRaw`INSERT INTO "WagerAllocation" ("id", "userId", "requirementId", "betKey", "amount")
            VALUES ${Prisma.join(values)} ON CONFLICT ("requirementId", "betKey")
            DO UPDATE SET "amount" = "WagerAllocation"."amount" + EXCLUDED."amount"`;
    }
    return requirements;
}
