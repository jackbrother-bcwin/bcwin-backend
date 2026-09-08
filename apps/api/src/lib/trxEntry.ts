import { prisma, Prisma } from "@bcwin/db";
import { SignJWT, jwtVerify } from "jose";
import { getUserWagerStatus } from "./wagerEngine";

const POLICY = "trx-entry-v1";
const secret = () => {
    if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required");
    return new TextEncoder().encode(process.env.JWT_SECRET);
};
export class TrxEntryError extends Error {}

async function lock(tx: Prisma.TransactionClient, userId: string) {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    return tx.user.findUniqueOrThrow({ where: { id: userId } });
}

async function snapshot(tx: Prisma.TransactionClient, userId: string) {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const wager = await getUserWagerStatus(userId, tx, { ignoreZeroWager: true });
    const target = Math.max(wager.trxWagerNeeded, Math.ceil(user.balance * 5));
    return {
        balance: user.balance, remainingBefore: wager.trxWagerNeeded,
        remainingAfter: target, addedWager: target - wager.trxWagerNeeded,
        totalAfter: wager.totalNeedToBet + target - wager.trxWagerNeeded,
        zeroWagerEnabled: user.zeroWagerEnabled, revision: user.trxVisitRevision,
        multiplier: 5, policyVersion: POLICY,
    };
}

export async function getTrxEntry(userId: string) {
    return prisma.$transaction(async (tx) => {
        const user = await lock(tx, userId);
        if (user.trxVisitId) return { available: true, active: true, visitId: user.trxVisitId };
        const data = await snapshot(tx, userId);
        const quote = await new SignJWT({ ...data })
            .setProtectedHeader({ alg: "HS256" }).setSubject(userId)
            .setAudience(POLICY).setIssuedAt().setExpirationTime("5m").sign(secret());
        return { available: true, active: false, ...data, quote };
    }, { timeout: 30_000 });
}

export async function acceptTrxEntry(userId: string, quote: string) {
    let payload;
    try {
        payload = (await jwtVerify(quote, secret(), { audience: POLICY, algorithms: ["HS256"] })).payload;
        if (payload.sub !== userId || payload.policyVersion !== POLICY) throw new Error();
    } catch {
        throw new TrxEntryError("Your TRX quote expired. Review the updated amount and accept again.");
    }
    return prisma.$transaction(async (tx) => {
        const user = await lock(tx, userId);
        // A retry of the same acceptance must not impose another requirement.
        if (user.trxVisitId && user.trxVisitRevision === Number(payload.revision) + 1) {
            return { available: true, active: true, visitId: user.trxVisitId };
        }
        const data = await snapshot(tx, userId);
        if (user.trxVisitId || ["balance", "remainingBefore", "remainingAfter", "totalAfter", "revision", "zeroWagerEnabled"]
            .some((key) => payload[key] !== data[key as keyof typeof data])) {
            throw new TrxEntryError("Your balance or wager changed. Review the updated amount and accept again.");
        }
        const consent = await tx.trxEntryConsent.create({ data: {
            userId, balance: data.balance, multiplier: 5,
            remainingBefore: data.remainingBefore, remainingAfter: data.remainingAfter,
            addedWager: data.addedWager, policyVersion: POLICY,
        } });
        if (data.addedWager > 0) await tx.wagerRequirement.create({ data: {
            userId, sourceType: "TRX_ENTRY", sourceId: consent.id,
            amount: data.addedWager / 5, multiplier: 5, requiredWager: data.addedWager,
            createdAt: new Date(),
        } });
        await tx.user.update({ where: { id: userId }, data: {
            trxVisitId: consent.id, trxVisitRevision: { increment: 1 },
        } });
        return { available: true, active: true, visitId: consent.id };
    }, { timeout: 30_000 });
}

/** Also called inside the successful withdrawal transaction. */
export async function endTrxVisit(tx: Prisma.TransactionClient, userId: string, expectedVisitId?: string) {
    const user = await lock(tx, userId);
    if (!user.trxVisitId || (expectedVisitId && expectedVisitId !== user.trxVisitId)) return;
    await tx.trxEntryConsent.update({ where: { id: user.trxVisitId }, data: { endedAt: new Date() } });
    await tx.user.update({ where: { id: userId }, data: {
        trxVisitId: null, trxVisitRevision: { increment: 1 },
    } });
}

export async function requireTrxVisit(tx: Prisma.TransactionClient, userId: string) {
    const user = await lock(tx, userId);
    if (!user.trxVisitId) throw new TrxEntryError("Accept the TRX entry wager before placing a bet.");
}
