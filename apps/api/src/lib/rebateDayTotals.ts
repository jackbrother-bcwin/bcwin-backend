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
