import { prisma, Prisma } from "@bcwin/db";
import { SystemSettings } from "@bcwin/config";

export type WagerCategory = "RECHARGE" | "REWARD";

/** Inclusive. Float leftovers never hit exact 0 (ADR-0027). */
export const LOW_BALANCE_WAGER_CLEAR = 5;
export const WAGER_TRANSACTION_TIMEOUT_MS = 15_000;

const DEFAULT_PENALTY_FACTOR = 1;

export function liveRechargeMultiplier(user: {
    hasIllegalBetPenalty: boolean;
    illegalBetPenaltyFactor: number | null;
    configWager: number;
    configPenalty?: number | null;
}): number {
    if (user.hasIllegalBetPenalty) {
        const userF = user.illegalBetPenaltyFactor;
        if (userF != null && userF > 0) return userF;
        const cfgF = user.configPenalty;
        return cfgF != null && cfgF > 0 ? cfgF : DEFAULT_PENALTY_FACTOR;
    }
    return user.configWager > 0 ? user.configWager : 1;
}

/**
 * Recharge wager follows the live admin factor (penalty or Config.wager).
 * Snapshot at deposit is only a starting value — raising 1x → 3x must reopen
 * remaining need, or 3x users withdraw after betting principal once.
 */
export async function syncRechargeWagerToLiveFactor(
    userId: string,
    liveMult: number,
    db: Prisma.TransactionClient | typeof prisma = prisma
) {
    if (!(liveMult > 0)) return;

    await db.$executeRaw`
        UPDATE "WagerRequirement"
        SET
            "multiplier" = ${liveMult},
            "requiredWager" = CEIL("amount" * ${liveMult}),
            "isCleared" = CASE
                WHEN CEIL("amount" * ${liveMult}) > "requiredWager" THEN false
                ELSE "isCleared"
            END,
            "updatedAt" = NOW()
        WHERE "userId" = ${userId}
          AND "sourceType" = 'RECHARGE'
          AND (
              "multiplier" IS DISTINCT FROM ${liveMult}
              OR "requiredWager" IS DISTINCT FROM CEIL("amount" * ${liveMult})
          )
    `;
}

/**
 * Creates a wager requirement record for a deposit or reward claim.
 */
export async function createWagerRequirement(
    tx: Prisma.TransactionClient | typeof prisma,
    userId: string,
    sourceType: WagerCategory,
    amount: number,
    sourceId?: string
) {
    if (amount <= 0) return null;

    let multiplier = 1.0;

    if (sourceType === "RECHARGE") {
        const user = await tx.user.findUnique({
            where: { id: userId },
            select: { hasIllegalBetPenalty: true, illegalBetPenaltyFactor: true },
        });
        const config = await SystemSettings.get();
        multiplier = liveRechargeMultiplier({
            hasIllegalBetPenalty: user?.hasIllegalBetPenalty ?? false,
            illegalBetPenaltyFactor: user?.illegalBetPenaltyFactor ?? null,
            configWager: config?.wager ?? 1,
            configPenalty: config?.illegalBetPenaltyFactor ?? DEFAULT_PENALTY_FACTOR,
        });
    } else if (sourceType === "REWARD") {
        const sysConfig = await SystemSettings.get();
        multiplier = (sysConfig as any)?.rewardWagerFactor ?? 1.0;
    }

    const requiredWager = Math.ceil(amount * multiplier);

    return tx.wagerRequirement.create({
        data: {
            userId,
            sourceType: sourceType as any,
            sourceId: sourceId || null,
            amount,
            multiplier,
            requiredWager,
            wagerCleared: 0,
            isCleared: requiredWager <= 0,
        },
    });
}

export interface UserWagerStatus {
    /** Combined basic deposit and illegal-penalty recharge wager. */
    depositWagerNeeded: number;
    /** Illegal-penalty portion of depositWagerNeeded. */
    penaltyWagerNeeded: number;
    rewardWagerNeeded: number;
    totalNeedToBet: number;
    isWithdrawalFrozen: boolean;
    activeRequirementsCount: number;
}

export interface WagerConfigSnapshot {
    wager?: number | null;
    illegalBetPenaltyFactor?: number | null;
}

export interface WagerUserSnapshot {
    balance: number;
    hasIllegalBetPenalty: boolean;
    illegalBetPenaltyFactor: number | null;
}

interface WagerRequirementStatusRow {
    id: string;
    sourceType: WagerCategory;
    amount: number;
    requiredWager: number;
    effectiveRequiredWager: number;
    createdAt: Date;
    totalBetsSince: number;
    isCleared: boolean;
}

const emptyWagerStatus = (): UserWagerStatus => ({
    depositWagerNeeded: 0,
    penaltyWagerNeeded: 0,
    rewardWagerNeeded: 0,
    totalNeedToBet: 0,
    isWithdrawalFrozen: false,
    activeRequirementsCount: 0,
});

/**
 * Reads every first-party game table once, then calculates a reverse running
 * total at each wager requirement timestamp. Inout/third-party bets are absent.
 */
async function loadRequirementsWithBetTotals(
    userId: string,
    liveRechargeFactor: number,
    db: Prisma.TransactionClient | typeof prisma
): Promise<WagerRequirementStatusRow[]> {
    return db.$queryRaw<WagerRequirementStatusRow[]>`
        WITH requirements AS MATERIALIZED (
            SELECT
                wr."id",
                wr."sourceType"::text AS "sourceType",
                wr."amount",
                wr."requiredWager",
                wr."isCleared",
                CASE
                    WHEN wr."sourceType" = 'RECHARGE'
                        THEN CEIL(wr."amount" * ${liveRechargeFactor})
                    ELSE wr."requiredWager"
                END AS "effectiveRequiredWager",
                wr."createdAt"
            FROM "WagerRequirement" wr
            WHERE wr."userId" = ${userId}
              AND (
                  (
                      wr."sourceType" = 'RECHARGE'
                      AND (
                          NOT wr."isCleared"
                          OR CEIL(wr."amount" * ${liveRechargeFactor}) > wr."requiredWager"
                      )
                  )
                  OR (wr."sourceType" = 'REWARD' AND NOT wr."isCleared")
              )
        ),
        bounds AS (
            SELECT MIN("createdAt") AS earliest
            FROM requirements
        ),
        bets_by_time AS MATERIALIZED (
            SELECT bets."createdAt", SUM(bets."betAmount")::double precision AS amount
            FROM (
                SELECT wb."createdAt", wb."betAmount"
                FROM "WingoBet" wb CROSS JOIN bounds
                WHERE wb."userId" = ${userId} AND wb."createdAt" >= bounds.earliest
                UNION ALL
                SELECT fb."createdAt", fb."betAmount"
                FROM "FiveDBet" fb CROSS JOIN bounds
                WHERE fb."userId" = ${userId} AND fb."createdAt" >= bounds.earliest
                UNION ALL
                SELECT kb."createdAt", kb."betAmount"
                FROM "K3Bet" kb CROSS JOIN bounds
                WHERE kb."userId" = ${userId} AND kb."createdAt" >= bounds.earliest
                UNION ALL
                SELECT mb."createdAt", mb."betAmount"
                FROM "MotoBet" mb CROSS JOIN bounds
                WHERE mb."userId" = ${userId} AND mb."createdAt" >= bounds.earliest
                UNION ALL
                SELECT tb."createdAt", tb."betAmount"
                FROM "TrxWingoBet" tb CROSS JOIN bounds
                WHERE tb."userId" = ${userId} AND tb."createdAt" >= bounds.earliest
            ) bets
            GROUP BY bets."createdAt"
        ),
        events AS (
            SELECT
                b."createdAt" AS event_at,
                0 AS event_kind,
                b.amount,
                NULL::text AS requirement_id
            FROM bets_by_time b
            UNION ALL
            SELECT
                r."createdAt" AS event_at,
                1 AS event_kind,
                0::double precision AS amount,
                r."id" AS requirement_id
            FROM requirements r
        ),
        running_totals AS (
            SELECT
                requirement_id,
                SUM(amount) OVER (
                    ORDER BY event_at DESC, event_kind ASC
                    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                )::double precision AS total
            FROM events
        )
        SELECT
            r."id",
            r."sourceType",
            r."amount",
            r."requiredWager",
            r."isCleared",
            r."effectiveRequiredWager",
            r."createdAt",
            COALESCE(rt.total, 0)::double precision AS "totalBetsSince"
        FROM requirements r
        JOIN running_totals rt ON rt.requirement_id = r."id"
        ORDER BY r."createdAt" ASC, r."id" ASC
    `;
}

async function calculateUserWagerStatus(
    userId: string,
    user: WagerUserSnapshot | null,
    config: WagerConfigSnapshot | null,
    db: Prisma.TransactionClient | typeof prisma,
    persist: boolean,
    snapshotRows?: WagerRequirementStatusRow[]
): Promise<UserWagerStatus> {
    if (!user) return emptyWagerStatus();

    if (user.balance <= LOW_BALANCE_WAGER_CLEAR) {
        if (persist) {
            await checkAndResetZeroBalanceWager(userId, user.balance, db);
        }
        return emptyWagerStatus();
    }

    const baseRechargeMultiplier = liveRechargeMultiplier({
        hasIllegalBetPenalty: false,
        illegalBetPenaltyFactor: null,
        configWager: config?.wager ?? 1,
    });
    const liveRechargeFactor = liveRechargeMultiplier({
        hasIllegalBetPenalty: user.hasIllegalBetPenalty,
        illegalBetPenaltyFactor: user.illegalBetPenaltyFactor,
        configWager: config?.wager ?? 1,
        configPenalty: config?.illegalBetPenaltyFactor ?? DEFAULT_PENALTY_FACTOR,
    });

    if (persist) {
        await syncRechargeWagerToLiveFactor(userId, liveRechargeFactor, db);
    }

    const requirements = snapshotRows ?? await loadRequirementsWithBetTotals(
        userId,
        liveRechargeFactor,
        db
    );
    if (requirements.length === 0) return emptyWagerStatus();

    let depositWagerNeeded = 0;
    let penaltyWagerNeeded = 0;
    let rewardWagerNeeded = 0;
    let timestampConsumedBets = 0;
    let previousTimestamp: number | null = null;
    const clearedIds: string[] = [];

    for (const req of requirements) {
        const timestamp = req.createdAt.getTime();
        if (timestamp !== previousTimestamp) {
            timestampConsumedBets = 0;
            previousTimestamp = timestamp;
        }

        const requiredWager = Number(req.effectiveRequiredWager);
        const availableBets = Math.max(
            0,
            Number(req.totalBetsSince) - timestampConsumedBets
        );
        timestampConsumedBets += requiredWager;

        if (availableBets >= requiredWager) {
            if (persist) clearedIds.push(req.id);
            continue;
        }

        const needed = Math.ceil(requiredWager - availableBets);
        if (req.sourceType === "RECHARGE") {
            depositWagerNeeded += needed;
            const baseRequiredWager = Math.min(
                requiredWager,
                Math.ceil(Number(req.amount) * baseRechargeMultiplier)
            );
            const baseNeeded = Math.min(
                needed,
                Math.max(0, Math.ceil(baseRequiredWager - availableBets))
            );
            penaltyWagerNeeded += needed - baseNeeded;
        } else {
            rewardWagerNeeded += needed;
        }
    }

    if (persist && clearedIds.length > 0) {
        await db.$executeRaw`
            UPDATE "WagerRequirement"
            SET
                "isCleared" = true,
                "wagerCleared" = "requiredWager",
                "updatedAt" = NOW()
            WHERE "id" IN (${Prisma.join(clearedIds)})
        `;
    }

    const totalNeedToBet = depositWagerNeeded + rewardWagerNeeded;
    return {
        depositWagerNeeded,
        penaltyWagerNeeded,
        rewardWagerNeeded,
        totalNeedToBet,
        isWithdrawalFrozen: totalNeedToBet > 0,
        activeRequirementsCount: requirements.length,
    };
}

/** Compare factors against one immutable stake/requirement snapshot; no wager mutations. */
export async function comparePenaltyWager(
    db: Prisma.TransactionClient,
    userId: string,
    user: WagerUserSnapshot,
    config: WagerConfigSnapshot | null,
    next: Pick<WagerUserSnapshot, "hasIllegalBetPenalty" | "illegalBetPenaltyFactor">
) {
    const factor = (state: WagerUserSnapshot) => liveRechargeMultiplier({
        ...state, configWager: config?.wager ?? 1,
        configPenalty: config?.illegalBetPenaltyFactor ?? DEFAULT_PENALTY_FACTOR,
    });
    const nextUser = { ...user, ...next };
    const previousFactor = factor(user);
    const resultingFactor = factor(nextUser);
    const rows = user.balance <= LOW_BALANCE_WAGER_CLEAR ? []
        : await loadRequirementsWithBetTotals(userId, Math.max(previousFactor, resultingFactor), db);
    const atFactor = (multiplier: number) => rows.map((row) => ({
        ...row,
        effectiveRequiredWager: row.sourceType === "RECHARGE"
            ? Math.ceil(row.amount * multiplier) : row.requiredWager,
    })).filter((row) => !row.isCleared || (
        row.sourceType === "RECHARGE" && row.effectiveRequiredWager > row.requiredWager
    ));
    const before = await calculateUserWagerStatus(userId, user, config, db, false, atFactor(previousFactor));
    const after = await calculateUserWagerStatus(userId, nextUser, config, db, false, atFactor(resultingFactor));
    return { previousFactor, resultingFactor, before, after };
}

/**
 * Computes active wager requirements for a user, enforcing:
 * 1. Timestamp-based clearing (bets placed at/after item creation).
 * 2. First-party stake only (third-party Inout bets excluded).
 * 3. Categorized breakdown, including the illegal-penalty share of recharge wager.
 */
export async function getUserWagerStatus(
    userId: string,
    tx?: Prisma.TransactionClient,
    configSnapshot?: WagerConfigSnapshot | null
): Promise<UserWagerStatus> {
    if (!tx) {
        const config = configSnapshot === undefined
            ? await SystemSettings.get()
            : configSnapshot;
        return prisma.$transaction(
            async (db) => {
                await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
                const user = await db.user.findUnique({
                    where: { id: userId },
                    select: {
                        balance: true,
                        hasIllegalBetPenalty: true,
                        illegalBetPenaltyFactor: true,
                    },
                });
                return calculateUserWagerStatus(userId, user, config, db, true);
            },
            { maxWait: 5_000, timeout: WAGER_TRANSACTION_TIMEOUT_MS }
        );
    }
    const config = configSnapshot === undefined
        ? await SystemSettings.get()
        : configSnapshot;
    const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
            balance: true,
            hasIllegalBetPenalty: true,
            illegalBetPenaltyFactor: true,
        },
    });

    return calculateUserWagerStatus(userId, user, config, tx, true);
}

/** Live admin/display snapshot. It never locks users or mutates wager rows. */
export async function getUserWagerStatusReadOnly(
    userId: string,
    userSnapshot?: WagerUserSnapshot | null,
    configSnapshot?: WagerConfigSnapshot | null
): Promise<UserWagerStatus> {
    const [user, config] = await Promise.all([
        userSnapshot === undefined
            ? prisma.user.findUnique({
                  where: { id: userId },
                  select: {
                      balance: true,
                      hasIllegalBetPenalty: true,
                      illegalBetPenaltyFactor: true,
                  },
              })
            : Promise.resolve(userSnapshot),
        configSnapshot === undefined
            ? SystemSettings.get()
            : Promise.resolve(configSnapshot),
    ]);
    return calculateUserWagerStatus(userId, user, config, prisma, false);
}

/**
 * Clears every open wager (RECHARGE + REWARD) when wallet is ≤ ₹5.
 * Leftover rupees stay; withdraw is allowed; next recharge starts a new row.
 */
export async function checkAndResetZeroBalanceWager(
    userId: string,
    currentBalance: number,
    db: Prisma.TransactionClient | typeof prisma = prisma
) {
    if (currentBalance > LOW_BALANCE_WAGER_CLEAR) return;
    await db.wagerRequirement.updateMany({
        where: {
            userId,
            isCleared: false,
        },
        data: {
            isCleared: true,
        },
    });
}
