import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { Cache } from "@bcwin/cache";
import { cachedAdminRead } from "@/lib/cachedAdminRead";
import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import {
    isValidYmd,
    parseYmdEndExclusiveIst,
    parseYmdStartIst,
    shiftYmdIst,
    ymdIst,
} from "@/lib/istDate";
import { moneyStatsByUser, betStatsByUser } from "@/lib/adminUserMetrics";
import { REAL_USER_WHERE } from "@/lib/realUserFilter";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";

const logger = new Logger("admin-users-team-day-analysis");

const PAGE_SIZE = 25;
const CACHE_TTL_SECONDS = 5 * 60;

export type SortMetric = "deposit" | "withdrawal" | "bet";
type Metric = { count: number; amount: number };
type MetricSet = {
    memberCount: number;
    deposit: Metric;
    withdrawal: Metric;
    bet: Metric;
};

type TeamMember = {
    id: string;
    username: string;
    mobileNumber: string;
    serialNumber: number;
    referralCode: string;
    level: number;
    legOwnerId: string;
};

type LegCore = MetricSet & {
    id: string;
    username: string;
    mobileNumber: string;
    serialNumber: number;
};

export type AnalysisCore = {
    date: string;
    self: MetricSet;
    team: MetricSet;
    levels: Array<MetricSet & { level: number }>;
    legs: LegCore[];
};

const metricSchema = z.object({
    count: z.number(),
    amount: z.number(),
});

const metricWithShareSchema = metricSchema.extend({
    share: z.number(),
});

const metricSetSchema = z.object({
    memberCount: z.number(),
    deposit: metricSchema,
    withdrawal: metricSchema,
    bet: metricSchema,
});

const legSchema = z.object({
    id: z.string(),
    username: z.string(),
    mobileNumber: z.string(),
    serialNumber: z.number(),
    memberCount: z.number(),
    deposit: metricWithShareSchema,
    withdrawal: metricWithShareSchema,
    bet: metricWithShareSchema,
});

const teamDayAnalysisResponseSchema = z.object({
    success: z.boolean(),
    date: z.string(),
    self: metricSetSchema,
    team: metricSetSchema,
    levels: z.array(metricSetSchema.extend({ level: z.number() })),
    concentration: z.object({
        isConcentrated: z.boolean(),
        threshold: z.number(),
        leader: z
            .object({
                id: z.string(),
                username: z.string(),
                serialNumber: z.number(),
                amount: z.number(),
                share: z.number(),
            })
            .nullable(),
    }),
    chart: z.array(
        z.object({
            id: z.string(),
            label: z.string(),
            amount: z.number(),
            share: z.number(),
            isOthers: z.boolean(),
        })
    ),
    legs: z.array(legSchema),
    pagination: z.object({
        page: z.number(),
        limit: z.number(),
        total: z.number(),
        totalPages: z.number(),
    }),
    sortBy: z.enum(["deposit", "withdrawal", "bet"]),
});

const getTeamDayAnalysisRoute = createRoute({
    method: "get",
    path: "/:id/team-day-analysis",
    tags: ["admin"],
    summary: "Get one-day L1 business contribution analysis",
    description:
        "Returns self, team, level, and mutually exclusive L1-leg metrics for one completed IST day.",
    request: {
        params: z.object({ id: z.string() }),
        query: z.object({
            date: z.string().optional().openapi({
                description: "Completed IST date; defaults to yesterday",
                example: "2026-08-29",
            }),
            sortBy: z
                .enum(["deposit", "withdrawal", "bet"])
                .default("deposit"),
            page: z.coerce.number().int().min(1).default(1),
            limit: z.coerce.number().int().min(1).max(PAGE_SIZE).default(PAGE_SIZE),
        }),
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": { schema: teamDayAnalysisResponseSchema },
            },
            description: "Daily team contribution analysis",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

function emptyMetric(): Metric {
    return { count: 0, amount: 0 };
}

function emptyMetricSet(memberCount = 0): MetricSet {
    return {
        memberCount,
        deposit: emptyMetric(),
        withdrawal: emptyMetric(),
        bet: emptyMetric(),
    };
}

function addMetric(target: Metric, source: Metric) {
    target.count += source.count;
    target.amount += source.amount;
}

function addMetricSet(target: MetricSet, source: MetricSet) {
    addMetric(target.deposit, source.deposit);
    addMetric(target.withdrawal, source.withdrawal);
    addMetric(target.bet, source.bet);
}

function validCompletedDate(date: string, maxDate: string): boolean {
    if (!isValidYmd(date) || date > maxDate) return false;
    const parsed = parseYmdStartIst(date);
    return !Number.isNaN(parsed.getTime()) && ymdIst(parsed) === date;
}

async function getLegMembers(rootReferralCode: string): Promise<TeamMember[]> {
    const members: TeamMember[] = [];
    let parents = new Map<string, string | null>([[rootReferralCode, null]]);

    for (let level = 1; level <= 6 && parents.size > 0; level++) {
        const children = await prisma.user.findMany({
            where: {
                referredBy: { in: [...parents.keys()] },
                ...REAL_USER_WHERE,
            },
            select: {
                id: true,
                username: true,
                mobileNumber: true,
                serialNumber: true,
                referralCode: true,
                referredBy: true,
            },
        });

        const nextParents = new Map<string, string>();
        for (const child of children) {
            const inheritedOwner = child.referredBy
                ? parents.get(child.referredBy)
                : undefined;
            const legOwnerId = level === 1 ? child.id : inheritedOwner;
            if (!legOwnerId) continue;

            members.push({
                id: child.id,
                username: child.username,
                mobileNumber: child.mobileNumber,
                serialNumber: child.serialNumber,
                referralCode: child.referralCode,
                level,
                legOwnerId,
            });
            nextParents.set(child.referralCode, legOwnerId);
        }
        parents = nextParents;
    }

    return members;
}

function userMetricSet(
    userId: string,
    deposits: Map<string, Metric>,
    withdrawals: Map<string, Metric>,
    bets: Map<string, Metric>
): MetricSet {
    return {
        memberCount: 1,
        deposit: deposits.get(userId) ?? emptyMetric(),
        withdrawal: withdrawals.get(userId) ?? emptyMetric(),
        bet: bets.get(userId) ?? emptyMetric(),
    };
}

export async function computeAnalysisCore(
    root: { id: string; referralCode: string; isDemo: boolean },
    date: string,
    includeBets = true
): Promise<AnalysisCore> {
    const levels = Array.from({ length: 6 }, (_, index) => ({
        level: index + 1,
        ...emptyMetricSet(),
    }));

    if (root.isDemo) {
        return {
            date,
            self: emptyMetricSet(1),
            team: emptyMetricSet(),
            levels,
            legs: [],
        };
    }

    const members = await getLegMembers(root.referralCode);
    const userIds = [root.id, ...members.map((member) => member.id)];
    const gte = parseYmdStartIst(date);
    const lt = parseYmdEndExclusiveIst(date);
    const [deposits, withdrawals, bets] = await Promise.all([
        moneyStatsByUser("deposit", userIds, gte, lt),
        moneyStatsByUser("withdrawal", userIds, gte, lt),
        includeBets
            ? betStatsByUser(userIds, gte, lt)
            : Promise.resolve(new Map<string, Metric>()),
    ]);

    const self = userMetricSet(root.id, deposits, withdrawals, bets);
    const team = emptyMetricSet(members.length);
    const directMembers = members.filter((member) => member.level === 1);
    const legMap = new Map<string, LegCore>(
        directMembers.map((member) => [
            member.id,
            {
                id: member.id,
                username: member.username,
                mobileNumber: member.mobileNumber,
                serialNumber: member.serialNumber,
                ...emptyMetricSet(),
            },
        ])
    );

    for (const member of members) {
        const metrics = userMetricSet(member.id, deposits, withdrawals, bets);
        addMetricSet(team, metrics);

        const level = levels[member.level - 1];
        if (level) {
            level.memberCount += 1;
            addMetricSet(level, metrics);
        }

        const leg = legMap.get(member.legOwnerId);
        if (leg) {
            leg.memberCount += 1;
            addMetricSet(leg, metrics);
        }
    }

    return { date, self, team, levels, legs: [...legMap.values()] };
}

function share(amount: number, total: number): number {
    return total > 0 ? (amount / total) * 100 : 0;
}

function metricWithShare(metric: Metric, total: Metric) {
    return { ...metric, share: share(metric.amount, total.amount) };
}

export function decorateLeg(leg: LegCore, team: MetricSet) {
    return {
        ...leg,
        deposit: metricWithShare(leg.deposit, team.deposit),
        withdrawal: metricWithShare(leg.withdrawal, team.withdrawal),
        bet: metricWithShare(leg.bet, team.bet),
    };
}

export function sortLegs(
    legs: ReturnType<typeof decorateLeg>[],
    sortBy: SortMetric
) {
    return [...legs].sort((a, b) => {
        const amountDifference = b[sortBy].amount - a[sortBy].amount;
        if (amountDifference !== 0) return amountDifference;
        return a.serialNumber - b.serialNumber;
    });
}

export const teamDayAnalysisRoutes = (app: OpenAPIHono) => {
    app.openapi(getTeamDayAnalysisRoute, async (c) => {
        try {
            const { id } = c.req.valid("param");
            const { sortBy, page, limit } = c.req.valid("query");
            const maxDate = shiftYmdIst(ymdIst(), -1);
            const date = c.req.valid("query").date ?? maxDate;

            if (!validCompletedDate(date, maxDate)) {
                return apiError(
                    c,
                    `Date must be a valid completed IST day on or before ${maxDate}`,
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            const root = await prisma.user.findUnique({
                where: { id },
                select: { id: true, referralCode: true, isDemo: true },
            });
            if (!root) {
                return apiError(c, "User not found", HTTP_STATUS.BAD_REQUEST);
            }

            const cacheKey = `admin:user-team-day-analysis:v1:${id}:${date}`;
            const core = await cachedAdminRead(cacheKey, CACHE_TTL_SECONDS,
                () => computeAnalysisCore(root, date));

            const decorated = core.legs.map((leg) => decorateLeg(leg, core.team));
            const sorted = sortLegs(decorated, sortBy);
            const total = sorted.length;
            const totalPages = Math.max(1, Math.ceil(total / limit));
            const safePage = Math.min(page, totalPages);
            const start = (safePage - 1) * limit;
            const legs = sorted.slice(start, start + limit);

            const chartTop = sorted.slice(0, 10).map((leg) => ({
                id: leg.id,
                label: `#${leg.serialNumber} ${leg.username}`,
                amount: leg[sortBy].amount,
                share: leg[sortBy].share,
                isOthers: false,
            }));
            if (sorted.length > 10) {
                const otherAmount = sorted
                    .slice(10)
                    .reduce((sum, leg) => sum + leg[sortBy].amount, 0);
                chartTop.push({
                    id: "others",
                    label: `Others (${sorted.length - 10})`,
                    amount: otherAmount,
                    share: share(otherAmount, core.team[sortBy].amount),
                    isOthers: true,
                });
            }

            const depositLeader = sortLegs(decorated, "deposit")[0] ?? null;
            const leader = depositLeader
                ? {
                      id: depositLeader.id,
                      username: depositLeader.username,
                      serialNumber: depositLeader.serialNumber,
                      amount: depositLeader.deposit.amount,
                      share: depositLeader.deposit.share,
                  }
                : null;

            return c.json(
                {
                    success: true,
                    date: core.date,
                    self: core.self,
                    team: core.team,
                    levels: core.levels,
                    concentration: {
                        isConcentrated:
                            core.team.deposit.amount > 0 &&
                            (leader?.share ?? 0) > 80,
                        threshold: 80,
                        leader,
                    },
                    chart: chartTop,
                    legs,
                    pagination: {
                        page: safePage,
                        limit,
                        total,
                        totalPages,
                    },
                    sortBy,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error fetching team day analysis:", error);
            return apiError(
                c,
                "Internal server error",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
