/**
 * Daily Agent commission (ADR-0036):
 * IST day 00:00–24:00 metrics → one rebate level → price that day's
 * downline bets → credit wallet once at the following 00:00 IST.
 * Level is not sticky; it is 0 until the next close.
 */
import { prisma, type RebateGameCategory, PaymentOrderStatus } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { mapGameToRebateCategory } from "./gameCategory";
import { RebateCalculator } from "./rebateCalculator";

const logger = new Logger("daily-team-rebate");

export type DayRange = { gte: Date; lt: Date };

export type DailyTeamMetrics = {
    teamSize: number;
    teamBetting: number;
    teamDeposit: number;
};

export type DailyRebatePreview = {
    rebateLevel: number;
    teamSize: number;
    teamBetting: number;
    teamDeposit: number;
    totalCommission: number;
    byLayer: Record<
        string,
        { commission: number; bet: number; users: number }
    >;
};

type TeamMember = { userId: string; layer: number; createdAt: Date };

type DayBet = {
    bettorId: string;
    betAmount: number;
    game: string;
    betId: string;
    createdAt: Date;
    inoutCategory?: string | null;
};

export function istDayRange(ymd: string): DayRange {
    const gte = new Date(`${ymd}T00:00:00+05:30`);
    const lt = new Date(gte.getTime() + 24 * 60 * 60 * 1000);
    return { gte, lt };
}

export function ymdIst(d = new Date()): string {
    const IST = 5.5 * 60 * 60 * 1000;
    const ist = new Date(d.getTime() + IST);
    const y = ist.getUTCFullYear();
    const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
    const day = String(ist.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

export function shiftYmdIst(ymd: string, days: number): string {
    const start = new Date(`${ymd}T00:00:00+05:30`);
    return ymdIst(new Date(start.getTime() + days * 24 * 60 * 60 * 1000));
}

export class DailyTeamRebate {
    static async qualifyLevel(metrics: DailyTeamMetrics): Promise<number> {
        const requirements = await prisma.vipLevelRequirement.findMany({
            orderBy: { level: "desc" },
        });
        for (const req of requirements) {
            if (
                metrics.teamSize >= req.teamSize &&
                metrics.teamBetting >= req.teamBetting &&
                metrics.teamDeposit >= req.teamDeposit
            ) {
                return req.level;
            }
        }
        return 0;
    }

    static async teamMembers(userId: string): Promise<TeamMember[]> {
        const out: TeamMember[] = [];
        let current = [userId];
        for (let layer = 1; layer <= 6; layer++) {
            if (current.length === 0) break;
            const codes = await prisma.user.findMany({
                where: { id: { in: current } },
                select: { referralCode: true },
            });
            if (codes.length === 0) break;
            const next = await prisma.user.findMany({
                where: {
                    referredBy: { in: codes.map((c) => c.referralCode) },
                    isDemo: false,
                },
                select: { id: true, createdAt: true },
            });
            for (const u of next) {
                out.push({
                    userId: u.id,
                    layer,
                    createdAt: u.createdAt,
                });
            }
            current = next.map((u) => u.id);
        }
        return out;
    }

    static async metricsForDay(
        userId: string,
        range: DayRange,
        members?: TeamMember[]
    ): Promise<DailyTeamMetrics> {
        const team = members ?? (await this.teamMembers(userId));
        const teamSize = team.filter(
            (m) => m.createdAt >= range.gte && m.createdAt < range.lt
        ).length;
        const ids = team.map((m) => m.userId);
        if (ids.length === 0) {
            return { teamSize, teamBetting: 0, teamDeposit: 0 };
        }
        const createdAt = { gte: range.gte, lt: range.lt };
        const [bets, deps] = await Promise.all([
            this.sumBetting(ids, createdAt),
            prisma.deposit.aggregate({
                where: {
                    userId: { in: ids },
                    status: PaymentOrderStatus.SUCCESS,
                    createdAt,
                },
                _sum: { amount: true },
            }),
        ]);
        return {
            teamSize,
            teamBetting: bets,
            teamDeposit: deps._sum.amount || 0,
        };
    }

    static async previewForUser(
        userId: string,
        ymd: string
    ): Promise<DailyRebatePreview> {
        const range = istDayRange(ymd);
        const members = await this.teamMembers(userId);
        const metrics = await this.metricsForDay(userId, range, members);
        const rebateLevel = await this.qualifyLevel(metrics);
        const byLayer: DailyRebatePreview["byLayer"] = {};
        for (let i = 1; i <= 6; i++) {
            byLayer[`L${i}`] = { commission: 0, bet: 0, users: 0 };
        }
        let totalCommission = 0;
        if (members.length === 0) {
            return { rebateLevel, ...metrics, totalCommission, byLayer };
        }
        const bets = await this.loadBets(
            range,
            members.map((m) => m.userId)
        );
        const layerOf = new Map(members.map((m) => [m.userId, m.layer]));
        const usersByLayer = new Map<number, Set<string>>();
        for (const bet of bets) {
            const layer = layerOf.get(bet.bettorId);
            if (!layer) continue;
            const category = mapGameToRebateCategory(
                bet.game,
                bet.inoutCategory
            );
            const rate = await this.rate(rebateLevel, category, layer);
            const amt = bet.betAmount * (rate / 100);
            const key = `L${layer}`;
            const row = byLayer[key]!;
            row.bet += bet.betAmount;
            row.commission += amt;
            totalCommission += amt;
            if (!usersByLayer.has(layer)) usersByLayer.set(layer, new Set());
            usersByLayer.get(layer)!.add(bet.bettorId);
        }
        for (const [layer, set] of usersByLayer) {
            byLayer[`L${layer}`]!.users = set.size;
        }
        return {
            rebateLevel,
            ...metrics,
            totalCommission: round3(totalCommission),
            byLayer: Object.fromEntries(
                Object.entries(byLayer).map(([k, v]) => [
                    k,
                    {
                        commission: round3(v.commission),
                        bet: round3(v.bet),
                        users: v.users,
                    },
                ])
            ),
        };
    }

    /**
     * Close IST day `ymd`: if unsettled rows already exist for that day
     * (legacy on-place accrue), settle them. Otherwise create rows from
     * that day's bets at that day's qualified level, then credit wallets.
     * Then rebateLevel = 0 for everyone.
     */
    static async processClosedIstDay(ymd: string): Promise<{
        created: number;
        settled: boolean;
    }> {
        const range = istDayRange(ymd);
        const existingUnsettled = await prisma.rebate.count({
            where: {
                settled: false,
                createdAt: { gte: range.gte, lt: range.lt },
            },
        });
        const existingSettled = await prisma.rebate.count({
            where: {
                settled: true,
                createdAt: { gte: range.gte, lt: range.lt },
            },
        });

        let created = 0;
        if (existingUnsettled === 0 && existingSettled === 0) {
            created = await this.accrueClosedDay(range);
        } else if (existingUnsettled === 0 && existingSettled > 0) {
            logger.info(
                `Day ${ymd} already settled (${existingSettled} rows); skip recreate`
            );
        } else {
            logger.info(
                `Day ${ymd} has ${existingUnsettled} legacy unsettled rows; settle only`
            );
        }

        await RebateCalculator.settleAllUnsettledRebates();
        await prisma.userVipLevel.updateMany({ data: { rebateLevel: 0 } });
        return { created, settled: true };
    }

    private static async accrueClosedDay(range: DayRange): Promise<number> {
        const bets = await this.loadBets(range);
        if (bets.length === 0) return 0;

        const chainCache = new Map<string, string[]>();
        const uplineIds = new Set<string>();
        for (const bet of bets) {
            const chain = await this.uplineIds(bet.bettorId, chainCache);
            for (const id of chain) uplineIds.add(id);
        }

        const levelByUpline = new Map<string, number>();
        const memberCache = new Map<string, TeamMember[]>();
        for (const uid of uplineIds) {
            const members = await this.teamMembers(uid);
            memberCache.set(uid, members);
            const metrics = await this.metricsForDay(uid, range, members);
            levelByUpline.set(uid, await this.qualifyLevel(metrics));
        }

        let created = 0;
        for (const bet of bets) {
            const chain = await this.uplineIds(bet.bettorId, chainCache);
            const category = mapGameToRebateCategory(
                bet.game,
                bet.inoutCategory
            );
            for (let layer = 1; layer <= chain.length; layer++) {
                const uplineId = chain[layer - 1]!;
                const already = await prisma.rebate.findFirst({
                    where: { userId: uplineId, betId: bet.betId },
                    select: { id: true },
                });
                if (already) continue;
                const level = levelByUpline.get(uplineId) ?? 0;
                const rate = await this.rate(level, category, layer);
                if (rate <= 0) continue;
                const amount = bet.betAmount * (rate / 100);
                if (amount <= 0) continue;
                await prisma.rebate.create({
                    data: {
                        userId: uplineId,
                        fromUserId: bet.bettorId,
                        amount,
                        game: String(bet.game).toUpperCase(),
                        gameCategory: category,
                        layer,
                        receiverVip: level,
                        rate,
                        betAmount: bet.betAmount,
                        betId: bet.betId,
                        settled: false,
                        createdAt: bet.createdAt,
                    },
                });
                created++;
            }
        }
        logger.info(`Accrued ${created} team rebate rows for closed day`);
        return created;
    }

    private static async uplineIds(
        bettorId: string,
        cache: Map<string, string[]>
    ): Promise<string[]> {
        const hit = cache.get(bettorId);
        if (hit) return hit;
        const ids: string[] = [];
        let current = bettorId;
        for (let i = 0; i < 6; i++) {
            const u = await prisma.user.findUnique({
                where: { id: current },
                select: { referredBy: true, isDemo: true },
            });
            if (!u?.referredBy) break;
            const up = await prisma.user.findUnique({
                where: { referralCode: u.referredBy },
                select: { id: true, isDemo: true },
            });
            if (!up) break;
            if (!up.isDemo) ids.push(up.id);
            current = up.id;
        }
        cache.set(bettorId, ids);
        return ids;
    }

    private static async rate(
        vipLevel: number,
        category: RebateGameCategory,
        layer: number
    ): Promise<number> {
        const config = await prisma.rebateRateConfig.findUnique({
            where: { vipLevel_category: { vipLevel, category } },
        });
        if (!config) return 0;
        const key = `layer${layer}` as
            | "layer1"
            | "layer2"
            | "layer3"
            | "layer4"
            | "layer5"
            | "layer6";
        return Number(config[key] ?? 0);
    }

    private static async sumBetting(
        userIds: string[],
        createdAt: DayRange
    ): Promise<number> {
        const whereUser = { userId: { in: userIds }, createdAt };
        const [w, f, k, m, t, i] = await Promise.all([
            prisma.wingoBet.aggregate({
                where: whereUser,
                _sum: { betAmount: true },
            }),
            prisma.fiveDBet.aggregate({
                where: whereUser,
                _sum: { betAmount: true },
            }),
            prisma.k3Bet.aggregate({
                where: whereUser,
                _sum: { betAmount: true },
            }),
            prisma.motoBet.aggregate({
                where: whereUser,
                _sum: { betAmount: true },
            }),
            prisma.trxWingoBet.aggregate({
                where: whereUser,
                _sum: { betAmount: true },
            }),
            prisma.inoutBet.aggregate({
                where: { ...whereUser, isRolledback: false },
                _sum: { betAmount: true },
            }),
        ]);
        return (
            (w._sum.betAmount || 0) +
            (f._sum.betAmount || 0) +
            (k._sum.betAmount || 0) +
            (m._sum.betAmount || 0) +
            (t._sum.betAmount || 0) +
            (i._sum.betAmount || 0)
        );
    }

    private static async loadBets(
        range: DayRange,
        onlyUserIds?: string[]
    ): Promise<DayBet[]> {
        const userFilter = onlyUserIds
            ? { userId: { in: onlyUserIds } }
            : {};
        const createdAt = { gte: range.gte, lt: range.lt };
        const where = { ...userFilter, createdAt };
        const [w, f, k, m, t, i] = await Promise.all([
            prisma.wingoBet.findMany({
                where,
                select: { id: true, userId: true, betAmount: true, createdAt: true },
            }),
            prisma.fiveDBet.findMany({
                where,
                select: { id: true, userId: true, betAmount: true, createdAt: true },
            }),
            prisma.k3Bet.findMany({
                where,
                select: { id: true, userId: true, betAmount: true, createdAt: true },
            }),
            prisma.motoBet.findMany({
                where,
                select: { id: true, userId: true, betAmount: true, createdAt: true },
            }),
            prisma.trxWingoBet.findMany({
                where,
                select: { id: true, userId: true, betAmount: true, createdAt: true },
            }),
            prisma.inoutBet.findMany({
                where: { ...where, isRolledback: false },
                select: {
                    id: true,
                    userId: true,
                    betAmount: true,
                    createdAt: true,
                    gameId: true,
                },
            }),
        ]);
        const demo = await demoUserSet([
            ...w,
            ...f,
            ...k,
            ...m,
            ...t,
            ...i,
        ].map((b) => b.userId));
        const out: DayBet[] = [];
        const push = (
            rows: { id: string; userId: string; betAmount: number; createdAt: Date }[],
            game: string
        ) => {
            for (const b of rows) {
                if (demo.has(b.userId) || b.betAmount <= 0) continue;
                out.push({
                    bettorId: b.userId,
                    betAmount: b.betAmount,
                    game,
                    betId: b.id,
                    createdAt: b.createdAt,
                });
            }
        };
        push(w, "WINGO");
        push(f, "5D");
        push(k, "K3");
        push(m, "MOTO");
        push(t, "TRXWINGO");
        for (const b of i) {
            if (demo.has(b.userId) || b.betAmount <= 0) continue;
            out.push({
                bettorId: b.userId,
                betAmount: b.betAmount,
                game: "INOUT",
                betId: b.id,
                createdAt: b.createdAt,
                inoutCategory: null,
            });
        }
        return out;
    }
}

async function demoUserSet(ids: string[]): Promise<Set<string>> {
    const uniq = [...new Set(ids)];
    if (uniq.length === 0) return new Set();
    const rows = await prisma.user.findMany({
        where: { id: { in: uniq }, isDemo: true },
        select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
}

function round3(n: number): number {
    return Math.round(n * 1000) / 1000;
}
