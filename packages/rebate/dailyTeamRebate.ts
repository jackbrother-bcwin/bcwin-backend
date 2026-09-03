/**
 * Daily Agent commission (ADR-0036):
 * IST day 00:00–24:00 metrics → one rebate level → price that day's
 * downline bets → credit wallet once at the following 00:00 IST.
 * Level is not sticky; it is 0 until the next close.
 */
import {
    prisma,
    type RebateGameCategory,
    PaymentOrderStatus,
    type Role,
} from "@bcwin/db";
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

export type DailyRebatePerson = {
    fromUserId: string;
    username: string;
    serialNumber: number | null;
    layer: number;
    commission: number;
    betVolume: number;
    bets: number;
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
    people: DailyRebatePerson[];
};

export type DailyRebateBetItem = {
    id: string;
    fromUserId: string;
    layer: number;
    betAmount: number;
    amount: number;
    rate: number;
    game: string;
    createdAt: string;
    settled: false;
};

type TeamMember = {
    userId: string;
    layer: number;
    createdAt: Date;
    username: string;
    serialNumber: number | null;
};

type DayBet = {
    bettorId: string;
    betAmount: number;
    game: string;
    betId: string;
    createdAt: Date;
    inoutCategory?: string | null;
};

type DayBetVolume = {
    bettorId: string;
    betAmount: number;
    game: string;
    inoutCategory?: string | null;
};

type UplineRef = {
    id: string;
    layer: number;
    role: Role;
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
                select: {
                    id: true,
                    createdAt: true,
                    username: true,
                    serialNumber: true,
                },
            });
            for (const u of next) {
                out.push({
                    userId: u.id,
                    layer,
                    createdAt: u.createdAt,
                    username: u.username,
                    serialNumber: u.serialNumber,
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
        const emptyPeople: DailyRebatePerson[] = [];
        if (members.length === 0) {
            return {
                rebateLevel,
                ...metrics,
                totalCommission,
                byLayer,
                people: emptyPeople,
            };
        }
        const bets = await this.loadBets(
            range,
            members.map((m) => m.userId)
        );
        const memberOf = new Map(members.map((m) => [m.userId, m]));
        const usersByLayer = new Map<number, Set<string>>();
        const byPerson = new Map<
            string,
            {
                layer: number;
                commission: number;
                betVolume: number;
                bets: number;
            }
        >();
        const rateCache = new Map<string, number>();
        for (const bet of bets) {
            const member = memberOf.get(bet.bettorId);
            if (!member) continue;
            const layer = member.layer;
            const category = mapGameToRebateCategory(
                bet.game,
                bet.inoutCategory
            );
            const rate = await this.rate(
                rebateLevel,
                category,
                layer,
                rateCache
            );
            const amt = bet.betAmount * (rate / 100);
            const key = `L${layer}`;
            const row = byLayer[key]!;
            row.bet += bet.betAmount;
            row.commission += amt;
            totalCommission += amt;
            if (!usersByLayer.has(layer)) usersByLayer.set(layer, new Set());
            usersByLayer.get(layer)!.add(bet.bettorId);
            const prev = byPerson.get(bet.bettorId) ?? {
                layer,
                commission: 0,
                betVolume: 0,
                bets: 0,
            };
            prev.commission += amt;
            prev.betVolume += bet.betAmount;
            prev.bets += 1;
            byPerson.set(bet.bettorId, prev);
        }
        for (const [layer, set] of usersByLayer) {
            byLayer[`L${layer}`]!.users = set.size;
        }
        const people: DailyRebatePerson[] = [...byPerson.entries()]
            .map(([id, p]) => {
                const m = memberOf.get(id);
                return {
                    fromUserId: id,
                    username: m?.username ?? "—",
                    serialNumber: m?.serialNumber ?? null,
                    layer: p.layer,
                    commission: round3(p.commission),
                    betVolume: round3(p.betVolume),
                    bets: p.bets,
                };
            })
            .sort((a, b) => b.commission - a.commission);
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
            people,
        };
    }

    /**
     * Sum the same live preview shown to individual users across all real
     * USER receivers. Events and referral chains are loaded in batches so the
     * admin dashboard does not run one preview query tree per account.
     */
    static async previewTotalForAllUsers(ymd: string): Promise<number> {
        const range = istDayRange(ymd);
        const [bets, joinedUsers, deposits, requirements, rateRows] =
            await Promise.all([
                this.loadBetVolumes(range),
                prisma.user.findMany({
                    where: { isDemo: false, createdAt: range },
                    select: { id: true },
                }),
                prisma.deposit.groupBy({
                    by: ["userId"],
                    where: {
                        status: PaymentOrderStatus.SUCCESS,
                        createdAt: range,
                        user: { isDemo: false },
                    },
                    _sum: { amount: true },
                }),
                prisma.vipLevelRequirement.findMany({
                    orderBy: { level: "desc" },
                }),
                prisma.rebateRateConfig.findMany(),
            ]);

        const eventUserIds = [
            ...bets.map((bet) => bet.bettorId),
            ...joinedUsers.map((user) => user.id),
            ...deposits.map((deposit) => deposit.userId),
        ];
        const chains = await this.uplineChainsForUsers(eventUserIds);
        const metrics = new Map<string, DailyTeamMetrics>();

        const addMetric = (
            sourceUserId: string,
            field: keyof DailyTeamMetrics,
            amount: number
        ) => {
            for (const upline of chains.get(sourceUserId) ?? []) {
                if (upline.role !== "USER") continue;
                const current = metrics.get(upline.id) ?? {
                    teamSize: 0,
                    teamBetting: 0,
                    teamDeposit: 0,
                };
                current[field] += amount;
                metrics.set(upline.id, current);
            }
        };

        for (const user of joinedUsers) {
            addMetric(user.id, "teamSize", 1);
        }
        for (const deposit of deposits) {
            addMetric(
                deposit.userId,
                "teamDeposit",
                deposit._sum.amount ?? 0
            );
        }
        for (const bet of bets) {
            addMetric(bet.bettorId, "teamBetting", bet.betAmount);
        }

        const levelByReceiver = new Map<string, number>();
        for (const [receiverId, values] of metrics) {
            const qualified = requirements.find(
                (requirement) =>
                    values.teamSize >= requirement.teamSize &&
                    values.teamBetting >= requirement.teamBetting &&
                    values.teamDeposit >= requirement.teamDeposit
            );
            levelByReceiver.set(receiverId, qualified?.level ?? 0);
        }

        const rates = new Map(
            rateRows.map((row) => [
                `${row.vipLevel}:${row.category}`,
                row,
            ])
        );
        let totalCommission = 0;
        for (const bet of bets) {
            const category = mapGameToRebateCategory(
                bet.game,
                bet.inoutCategory
            );
            for (const upline of chains.get(bet.bettorId) ?? []) {
                if (upline.role !== "USER") continue;
                const level = levelByReceiver.get(upline.id) ?? 0;
                const rateRow = rates.get(`${level}:${category}`);
                const layerKey = `layer${upline.layer}` as
                    | "layer1"
                    | "layer2"
                    | "layer3"
                    | "layer4"
                    | "layer5"
                    | "layer6";
                const rate = Number(rateRow?.[layerKey] ?? 0);
                totalCommission += bet.betAmount * (rate / 100);
            }
        }

        return round3(totalCommission);
    }

    /** Paginated live today bets for one downline (not Rebate rows). */
    static async previewBetsForPerson(
        agentId: string,
        ymd: string,
        fromUserId: string,
        page: number,
        limit: number
    ): Promise<{
        items: DailyRebateBetItem[];
        total: number;
        currentPage: number;
        totalPages: number;
    }> {
        const range = istDayRange(ymd);
        const members = await this.teamMembers(agentId);
        const member = members.find((m) => m.userId === fromUserId);
        if (!member) {
            return { items: [], total: 0, currentPage: 1, totalPages: 1 };
        }
        const metrics = await this.metricsForDay(agentId, range, members);
        const rebateLevel = await this.qualifyLevel(metrics);
        const bets = await this.loadBets(range, [fromUserId]);
        bets.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const rateCache = new Map<string, number>();
        const priced: DailyRebateBetItem[] = [];
        for (const bet of bets) {
            const category = mapGameToRebateCategory(
                bet.game,
                bet.inoutCategory
            );
            const rate = await this.rate(
                rebateLevel,
                category,
                member.layer,
                rateCache
            );
            const amt = bet.betAmount * (rate / 100);
            priced.push({
                id: bet.betId,
                fromUserId,
                layer: member.layer,
                betAmount: round3(bet.betAmount),
                amount: round3(amt),
                rate,
                game: bet.game,
                createdAt: bet.createdAt.toISOString(),
                settled: false,
            });
        }
        const total = priced.length;
        const totalPages = Math.max(1, Math.ceil(total / limit) || 1);
        const currentPage = Math.min(Math.max(1, page), totalPages);
        const skip = (currentPage - 1) * limit;
        return {
            items: priced.slice(skip, skip + limit),
            total,
            currentPage,
            totalPages,
        };
    }

    /**
     * Expand-a-person rows: live today preview bets (if range includes today)
     * then settled Rebate rows for the rest of the range. No double-count of today.
     */
    static async personBetsForAgent(
        agentId: string,
        opts: {
            fromUserId: string;
            startYmd?: string;
            endYmd?: string;
            page: number;
            limit: number;
            layer?: number;
        }
    ): Promise<{
        items: Array<DailyRebateBetItem | {
            id: string;
            fromUserId: string;
            layer: number;
            betAmount: number;
            amount: number;
            rate: number;
            game: string;
            createdAt: string;
            settled: boolean;
        }>;
        total: number;
        currentPage: number;
        totalPages: number;
    }> {
        const today = ymdIst();
        const end = opts.endYmd;
        const start = opts.startYmd;
        const includesToday = !end || end >= today;
        const todayOnly = start === today && (!end || end === today);

        type Row = {
            id: string;
            fromUserId: string;
            layer: number;
            betAmount: number;
            amount: number;
            rate: number;
            game: string;
            createdAt: string;
            settled: boolean;
        };

        let live: DailyRebateBetItem[] = [];
        if (includesToday) {
            const all = await this.previewBetsForPerson(
                agentId,
                today,
                opts.fromUserId,
                1,
                500
            );
            live = all.items;
            if (opts.layer != null) {
                live = live.filter((r) => r.layer === opts.layer);
            }
        }

        const histWhere: {
            userId: string;
            fromUserId: string;
            settled: true;
            layer?: number;
            createdAt?: { gte?: Date; lt?: Date };
        } = {
            userId: agentId,
            fromUserId: opts.fromUserId,
            settled: true,
        };
        if (opts.layer != null) histWhere.layer = opts.layer;
        if (todayOnly) {
            // today is live-only
        } else if (includesToday) {
            histWhere.createdAt = {
                ...(start ? { gte: istDayRange(start).gte } : {}),
                lt: istDayRange(today).gte,
            };
        } else if (start || end) {
            histWhere.createdAt = {
                ...(start ? { gte: istDayRange(start).gte } : {}),
                ...(end ? { lt: istDayRange(end).lt } : {}),
            };
        }

        const histTotal = todayOnly
            ? 0
            : await prisma.rebate.count({ where: histWhere });
        const total = live.length + histTotal;
        const totalPages = Math.max(1, Math.ceil(total / opts.limit) || 1);
        const currentPage = Math.min(Math.max(1, opts.page), totalPages);
        const skip = (currentPage - 1) * opts.limit;

        const items: Row[] = [];
        if (skip < live.length) {
            items.push(
                ...live.slice(skip, skip + opts.limit).map((r) => ({
                    ...r,
                    settled: false as const,
                }))
            );
        }
        const need = opts.limit - items.length;
        if (need > 0 && !todayOnly) {
            const histSkip = Math.max(0, skip - live.length);
            const hist = await prisma.rebate.findMany({
                where: histWhere,
                orderBy: { createdAt: "desc" },
                skip: histSkip,
                take: need,
                select: {
                    id: true,
                    fromUserId: true,
                    layer: true,
                    betAmount: true,
                    amount: true,
                    rate: true,
                    game: true,
                    createdAt: true,
                    settled: true,
                },
            });
            for (const r of hist) {
                items.push({
                    id: r.id,
                    fromUserId: r.fromUserId ?? opts.fromUserId,
                    layer: r.layer ?? 0,
                    betAmount: Number(r.betAmount ?? 0),
                    amount: Number(r.amount ?? 0),
                    rate: Number(r.rate ?? 0),
                    game: r.game,
                    createdAt: r.createdAt.toISOString(),
                    settled: r.settled,
                });
            }
        }
        return { items, total, currentPage, totalPages };
    }

    /**
     * Close IST day `ymd`: price that day's downline bets at that day's
     * qualified level (starts 0 at 00:00, steps up as conditions clear).
     * Skips (userId, betId) pairs that already have a row. Then credit
     * wallets and set rebateLevel = 0.
     */
    static async processClosedIstDay(ymd: string): Promise<{
        created: number;
        settled: boolean;
    }> {
        const range = istDayRange(ymd);
        const created = await this.accrueClosedDay(range);
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
        const rateCache = new Map<string, number>();
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
                const rate = await this.rate(
                    level,
                    category,
                    layer,
                    rateCache
                );
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
        layer: number,
        cache?: Map<string, number>
    ): Promise<number> {
        const cacheKey = `${vipLevel}:${category}:${layer}`;
        if (cache?.has(cacheKey)) return cache.get(cacheKey)!;
        const config = await prisma.rebateRateConfig.findUnique({
            where: { vipLevel_category: { vipLevel, category } },
        });
        if (!config) {
            cache?.set(cacheKey, 0);
            return 0;
        }
        const key = `layer${layer}` as
            | "layer1"
            | "layer2"
            | "layer3"
            | "layer4"
            | "layer5"
            | "layer6";
        const n = Number(config[key] ?? 0);
        cache?.set(cacheKey, n);
        return n;
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
                    gameMode: true,
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
        const modes = [...new Set(i.map((b) => b.gameMode).filter(Boolean))];
        const catByMode = new Map<string, string>();
        if (modes.length) {
            const games = await prisma.inoutGame.findMany({
                where: { gameMode: { in: modes } },
                select: { gameMode: true, category: true },
            });
            for (const g of games) catByMode.set(g.gameMode, g.category);
        }
        for (const b of i) {
            if (demo.has(b.userId) || b.betAmount <= 0) continue;
            out.push({
                bettorId: b.userId,
                betAmount: b.betAmount,
                game: "INOUT",
                betId: b.id,
                createdAt: b.createdAt,
                inoutCategory: catByMode.get(b.gameMode) ?? null,
            });
        }
        return out;
    }

    private static async loadBetVolumes(
        range: DayRange
    ): Promise<DayBetVolume[]> {
        const where = {
            createdAt: range,
            user: { isDemo: false },
        };
        const [wingo, fiveD, k3, moto, trxWingo, inout] = await Promise.all([
            prisma.wingoBet.groupBy({
                by: ["userId"],
                where,
                _sum: { betAmount: true },
            }),
            prisma.fiveDBet.groupBy({
                by: ["userId"],
                where,
                _sum: { betAmount: true },
            }),
            prisma.k3Bet.groupBy({
                by: ["userId"],
                where,
                _sum: { betAmount: true },
            }),
            prisma.motoBet.groupBy({
                by: ["userId"],
                where,
                _sum: { betAmount: true },
            }),
            prisma.trxWingoBet.groupBy({
                by: ["userId"],
                where,
                _sum: { betAmount: true },
            }),
            prisma.inoutBet.groupBy({
                by: ["userId", "gameMode"],
                where: { ...where, isRolledback: false },
                _sum: { betAmount: true },
            }),
        ]);

        const volumes: DayBetVolume[] = [];
        const add = (
            rows: Array<{ userId: string; _sum: { betAmount: number | null } }>,
            game: string
        ) => {
            for (const row of rows) {
                const betAmount = row._sum.betAmount ?? 0;
                if (betAmount > 0) {
                    volumes.push({ bettorId: row.userId, betAmount, game });
                }
            }
        };
        add(wingo, "WINGO");
        add(fiveD, "5D");
        add(k3, "K3");
        add(moto, "MOTO");
        add(trxWingo, "TRXWINGO");

        const gameModes = [...new Set(inout.map((row) => row.gameMode))];
        const inoutGames = gameModes.length
            ? await prisma.inoutGame.findMany({
                  where: { gameMode: { in: gameModes } },
                  select: { gameMode: true, category: true },
              })
            : [];
        const categoryByMode = new Map(
            inoutGames.map((game) => [game.gameMode, game.category])
        );
        for (const row of inout) {
            const betAmount = row._sum.betAmount ?? 0;
            if (betAmount <= 0) continue;
            volumes.push({
                bettorId: row.userId,
                betAmount,
                game: "INOUT",
                inoutCategory: categoryByMode.get(row.gameMode) ?? null,
            });
        }

        return volumes;
    }

    private static async uplineChainsForUsers(
        userIds: string[]
    ): Promise<Map<string, UplineRef[]>> {
        const uniqueIds = [...new Set(userIds)];
        const chains = new Map<string, UplineRef[]>(
            uniqueIds.map((id) => [id, []])
        );
        let currentBySource = new Map(
            uniqueIds.map((id) => [id, id] as const)
        );

        for (let layer = 1; layer <= 6 && currentBySource.size > 0; layer++) {
            const currentUsers = await prisma.user.findMany({
                where: { id: { in: [...new Set(currentBySource.values())] } },
                select: { id: true, referredBy: true },
            });
            const referralByUserId = new Map(
                currentUsers.map((user) => [user.id, user.referredBy])
            );
            const referralCodes = [
                ...new Set(
                    currentUsers.flatMap((user) =>
                        user.referredBy ? [user.referredBy] : []
                    )
                ),
            ];
            if (referralCodes.length === 0) break;

            const parents = await prisma.user.findMany({
                where: {
                    referralCode: { in: referralCodes },
                    isDemo: false,
                },
                select: { id: true, referralCode: true, role: true },
            });
            const parentByReferralCode = new Map(
                parents.map((parent) => [parent.referralCode, parent])
            );
            const nextBySource = new Map<string, string>();

            for (const [sourceId, currentId] of currentBySource) {
                const referralCode = referralByUserId.get(currentId);
                if (!referralCode) continue;
                const parent = parentByReferralCode.get(referralCode);
                if (!parent) continue;
                chains.get(sourceId)!.push({
                    id: parent.id,
                    layer,
                    role: parent.role,
                });
                nextBySource.set(sourceId, parent.id);
            }
            currentBySource = nextBySource;
        }

        return chains;
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
