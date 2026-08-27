import { prisma, Prisma } from "@bcwin/db";
import { parseYmdEndExclusiveIst, parseYmdStartIst } from "./istDate";

export type RebateSettledFilter = boolean | "all";

function settledSql(settled: RebateSettledFilter | undefined): Prisma.Sql | null {
    if (settled === true) return Prisma.sql`settled = true`;
    if (settled === false) return Prisma.sql`settled = false`;
    return null;
}

function whereRebate(opts: {
    userId: string;
    startYmd?: string;
    endYmd?: string;
    settled?: RebateSettledFilter;
    layer?: number;
}): Prisma.Sql {
    const parts: Prisma.Sql[] = [Prisma.sql`"userId" = ${opts.userId}`];
    const s = settledSql(opts.settled);
    if (s) parts.push(s);
    if (opts.startYmd) {
        parts.push(
            Prisma.sql`"createdAt" >= ${parseYmdStartIst(opts.startYmd)}`
        );
    }
    if (opts.endYmd) {
        parts.push(
            Prisma.sql`"createdAt" < ${parseYmdEndExclusiveIst(opts.endYmd)}`
        );
    }
    if (opts.layer != null) {
        parts.push(Prisma.sql`layer = ${opts.layer}`);
    }
    return Prisma.join(parts, " AND ");
}

/** One IST calendar day per row. No FE paging of rebate history. */
export async function rebateTotalsByIstDay(opts: {
    userId: string;
    startYmd?: string;
    endYmd?: string;
    settled?: RebateSettledFilter;
}): Promise<Array<{ date: string; total: number }>> {
    const where = whereRebate(opts);
    const rows = await prisma.$queryRaw<Array<{ day: string; total: number }>>(
        Prisma.sql`
            SELECT to_char(
                ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata',
                'YYYY-MM-DD'
            ) AS day,
            COALESCE(SUM(amount), 0)::float AS total
            FROM "Rebate"
            WHERE ${where}
            GROUP BY 1
            ORDER BY 1 DESC
            LIMIT 400
        `
    );
    return rows.map((r) => ({
        date: String(r.day),
        total: Number(r.total) || 0,
    }));
}

export async function sumRebateAmount(opts: {
    userId: string;
    startYmd: string;
    endYmd: string;
    settled?: RebateSettledFilter;
}): Promise<number> {
    const where = whereRebate(opts);
    const rows = await prisma.$queryRaw<Array<{ total: number }>>(
        Prisma.sql`
            SELECT COALESCE(SUM(amount), 0)::float AS total
            FROM "Rebate"
            WHERE ${where}
        `
    );
    return Number(rows[0]?.total) || 0;
}

export type RebatePersonRow = {
    fromUserId: string;
    username: string;
    serialNumber: number | null;
    layer: number;
    commission: number;
    betVolume: number;
    bets: number;
};

export type RebateLayerRow = {
    commission: number;
    bet: number;
    users: number;
};

/** Collapsed Agent Commission list: one row per downline, not every bet. */
export async function rebatePeopleTotals(opts: {
    userId: string;
    startYmd?: string;
    endYmd?: string;
    settled?: RebateSettledFilter;
    layer?: number;
}): Promise<{
    people: RebatePersonRow[];
    summary: {
        commission: number;
        betVolume: number;
        bets: number;
        bettors: number;
    };
    byDay: Array<{ date: string; commission: number }>;
    byLayer: Record<string, RebateLayerRow>;
}> {
    const where = whereRebate(opts);
    const [grouped, days, layers] = await Promise.all([
        prisma.$queryRaw<
            Array<{
                fromUserId: string;
                layer: number | null;
                commission: number;
                betVolume: number;
                bets: number;
            }>
        >(Prisma.sql`
            SELECT
                "fromUserId",
                layer,
                COALESCE(SUM(amount), 0)::float AS commission,
                COALESCE(SUM("betAmount"), 0)::float AS "betVolume",
                COUNT(*)::int AS bets
            FROM "Rebate"
            WHERE ${where}
              AND "fromUserId" IS NOT NULL
            GROUP BY "fromUserId", layer
            ORDER BY commission DESC
        `),
        prisma.$queryRaw<Array<{ day: string; total: number }>>(Prisma.sql`
            SELECT to_char(
                ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata',
                'YYYY-MM-DD'
            ) AS day,
            COALESCE(SUM(amount), 0)::float AS total
            FROM "Rebate"
            WHERE ${where}
            GROUP BY 1
            ORDER BY 1 DESC
        `),
        prisma.$queryRaw<
            Array<{
                layer: number | null;
                commission: number;
                bet: number;
                users: number;
            }>
        >(Prisma.sql`
            SELECT
                layer,
                COALESCE(SUM(amount), 0)::float AS commission,
                COALESCE(SUM("betAmount"), 0)::float AS bet,
                COUNT(DISTINCT "fromUserId")::int AS users
            FROM "Rebate"
            WHERE ${where}
            GROUP BY layer
        `),
    ]);

    const ids = [...new Set(grouped.map((r) => r.fromUserId))];
    const users =
        ids.length === 0
            ? []
            : await prisma.user.findMany({
                  where: { id: { in: ids } },
                  select: {
                      id: true,
                      username: true,
                      serialNumber: true,
                  },
              });
    const byId = new Map(users.map((u) => [u.id, u]));

    const people: RebatePersonRow[] = grouped.map((r) => {
        const u = byId.get(r.fromUserId);
        return {
            fromUserId: r.fromUserId,
            username: u?.username ?? "—",
            serialNumber: u?.serialNumber ?? null,
            layer: Number(r.layer ?? 0),
            commission: Number(r.commission) || 0,
            betVolume: Number(r.betVolume) || 0,
            bets: Number(r.bets) || 0,
        };
    });

    let commission = 0;
    let betVolume = 0;
    let bets = 0;
    const bettors = new Set<string>();
    for (const p of people) {
        commission += p.commission;
        betVolume += p.betVolume;
        bets += p.bets;
        bettors.add(p.fromUserId);
    }

    const byLayer: Record<string, RebateLayerRow> = {};
    for (let i = 1; i <= 6; i++) {
        byLayer[`L${i}`] = { commission: 0, bet: 0, users: 0 };
    }
    for (const r of layers) {
        const L = Number(r.layer ?? 0);
        if (L < 1 || L > 6) continue;
        byLayer[`L${L}`] = {
            commission: Number(r.commission) || 0,
            bet: Number(r.bet) || 0,
            users: Number(r.users) || 0,
        };
    }

    return {
        people,
        summary: {
            commission,
            betVolume,
            bets,
            bettors: bettors.size,
        },
        byDay: days.map((d) => ({
            date: String(d.day),
            commission: Number(d.total) || 0,
        })),
        byLayer,
    };
}
