import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie, limit, page } from "@/schemas";
import { prisma } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import {
    AUTO_SALARY_SLABS,
    computeUserSalaryMetrics,
    formatIstYmd,
    getIstDayRange,
    matchHighestSlab,
    slabMet,
    slabRequiredActive,
    type SalaryMetrics,
} from "@/lib/autoSalaryService";
import { TeamMetricsCalculator } from "@/lib/teamMetricsCalculator";

const logger = new Logger("user-salary");

const AutoSalaryClaimItemSchema = z.object({
    id: z.string(),
    amount: z.number(),
    periodDate: z.string(),
    status: z.enum(["PENDING", "APPROVED", "REJECTED"]),
    slabIndex: z.number(),
    directCount: z.number(),
    activeCount: z.number(),
    teamDeposit: z.number(),
    rejectReason: z.string().nullable().optional(),
    reviewedAt: z.string().nullable().optional(),
    createdAt: z.string(),
    /** Human note for CS / UI */
    note: z.string().optional(),
});

/** Backward-compatible row used by transactions ledger (approved only when status filter default) */
const SalaryPaymentSchema = z.object({
    id: z.string(),
    amount: z.number(),
    createdAt: z.string(),
    note: z.string().optional(),
    status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
    periodDate: z.string().optional(),
});

const getUserSalaryRoute = createRoute({
    method: "get",
    path: "/salary",
    tags: ["user"],
    summary: "Get auto-salary claim history",
    description:
        "Paginated auto-salary claims (admin generate → approve). Includes PENDING (awaiting admin), APPROVED (credited), REJECTED. Optional status / date filters (IST YYYY-MM-DD). `payments` lists items for the transactions ledger (APPROVED by default).",
    request: {
        query: z.object({
            page,
            limit,
            startDate: z
                .string()
                .regex(/^\d{4}-\d{2}-\d{2}$/)
                .optional()
                .openapi({ example: "2026-07-01" }),
            endDate: z
                .string()
                .regex(/^\d{4}-\d{2}-\d{2}$/)
                .optional()
                .openapi({ example: "2026-07-24" }),
            status: z
                .enum(["PENDING", "APPROVED", "REJECTED", "ALL"])
                .optional()
                .default("ALL")
                .openapi({
                    description:
                        "Filter by claim status. ALL = every claim for salary panel.",
                }),
            /** When true, payments[] only APPROVED (for wallet transactions) */
            creditedOnly: z
                .enum(["true", "false"])
                .optional()
                .openapi({
                    description:
                        "If true, payments[] only includes APPROVED claims (default false for panel history).",
                }),
        }),
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        claims: z.array(AutoSalaryClaimItemSchema),
                        payments: z.array(SalaryPaymentSchema),
                        total: z.number(),
                        currentPage: z.number(),
                        totalPages: z.number(),
                        summary: z.object({
                            /** Lifetime / filtered APPROVED total (wallet-credited) */
                            totalReceived: z.number(),
                            totalAmount: z.number(),
                            pendingTotal: z.number(),
                            credits: z.number(),
                            pendingCount: z.number(),
                        }),
                    }),
                },
            },
            description: "Auto-salary history",
        },
        ...CommonResponses.internalServerError(),
    },
});

const salaryDashboardRoute = createRoute({
    method: "get",
    path: "/salary/dashboard",
    tags: ["user"],
    summary: "Salary dashboard",
    description:
        "Live salary progress: metrics, slabs, eligibility, next steps, recent claims",
    request: {
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        data: z.record(z.string(), z.unknown()),
                    }),
                },
            },
            description: "Salary dashboard",
        },
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

function shiftIstYmd(ymd: string, days: number): string {
    const { periodDate } = getIstDayRange(ymd);
    const d = new Date(periodDate.getTime() + days * 86_400_000);
    return formatIstYmd(d);
}

async function dayMetrics(userId: string, ymd: string): Promise<SalaryMetrics> {
    const { start, end } = getIstDayRange(ymd);
    return computeUserSalaryMetrics(userId, start, end);
}

async function buildEligibility(userId: string, metrics: SalaryMetrics) {
    const team = await TeamMetricsCalculator.getTeamMembers(userId, 6);
    const l1 = team.filter((m) => m.layer === 1);
    const allIds = team.map((m) => m.user.id);

    // Top-leg balance: L1 deposit share of each direct's downline (self + their tree is heavy).
    // Practical check: each L1 member's own lifetime deposit vs sum of L1 deposits.
    let topLegOk = true;
    let topLegDetail =
        "Needs at least 2 direct legs — start building your second leg.";
    if (l1.length >= 2) {
        const l1Ids = l1.map((m) => m.user.id);
        const depByUser = await prisma.deposit.groupBy({
            by: ["userId"],
            where: {
                userId: { in: l1Ids },
                status: "SUCCESS",
                user: { isDemo: false },
            },
            _sum: { amount: true },
        });
        const amounts = l1Ids.map((id) => {
            const row = depByUser.find((d) => d.userId === id);
            return row?._sum.amount ?? 0;
        });
        const total = amounts.reduce((a, b) => a + b, 0);
        const top = amounts.length ? Math.max(...amounts) : 0;
        const ratio = total > 0 ? top / total : 0;
        topLegOk = ratio <= 0.8;
        topLegDetail = topLegOk
            ? "Business is balanced across legs."
            : `Top leg holds ${Math.round(ratio * 100)}% of L1 deposits — keep ≤ 80%.`;
    } else if (l1.length === 1) {
        topLegOk = false;
    } else {
        topLegOk = false;
    }

    // Shared IP among team
    let sharedIpOk = true;
    let sharedIpDetail = "No shared-IP accounts in your team.";
    if (allIds.length > 0) {
        const users = await prisma.user.findMany({
            where: { id: { in: allIds }, isDemo: false },
            select: { ip: true },
        });
        const counts = new Map<string, number>();
        for (const u of users) {
            if (!u.ip) continue;
            counts.set(u.ip, (counts.get(u.ip) ?? 0) + 1);
        }
        const shared = [...counts.values()].filter((n) => n > 1).length;
        if (shared > 0) {
            sharedIpOk = false;
            sharedIpDetail = `${shared} shared IP group(s) detected in your team.`;
        }
    }

    // Shared bank accounts
    let sharedBankOk = true;
    let sharedBankDetail = "No shared bank accounts in your team.";
    if (allIds.length > 0) {
        const banks = await prisma.bank.findMany({
            where: { userId: { in: allIds } },
            select: { bankAccount: true, upiId: true, trc20Address: true, bep20Address: true },
        });
        const keyCount = new Map<string, number>();
        for (const b of banks) {
            for (const raw of [b.bankAccount, b.upiId, b.trc20Address, b.bep20Address]) {
                const k = (raw ?? "").trim().toLowerCase();
                if (!k) continue;
                keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
            }
        }
        const shared = [...keyCount.values()].filter((n) => n > 1).length;
        if (shared > 0) {
            sharedBankOk = false;
            sharedBankDetail = `${shared} shared payment detail(s) in your team.`;
        }
    }

    // Cross-trading / illegal flags on team
    let crossOk = true;
    let crossDetail = "No cross-trading flags on your team.";
    if (allIds.length > 0) {
        const flags = await prisma.illegalBet.count({
            where: {
                userId: { in: allIds },
                createdAt: {
                    gte: new Date(Date.now() - 30 * 86_400_000),
                },
            },
        });
        if (flags > 0) {
            crossOk = false;
            crossDetail = `${flags} illegal bet flag(s) in the last 30 days.`;
        }
    }

    const businessPositive =
        metrics.teamDeposit > 0 ||
        metrics.directCount > 0 ||
        metrics.activeCount > 0;
    const first = AUTO_SALARY_SLABS[0]!;
    const activeNeed = slabRequiredActive(first);
    const activeOk =
        metrics.directCount >= first.direct &&
        metrics.activeCount >= activeNeed;

    return [
        {
            id: "business_report",
            title: "Business report positive",
            ok: businessPositive || metrics.directCount === 0,
            detail: businessPositive
                ? "Your team business report is healthy."
                : "Build team activity to keep the report positive.",
        },
        {
            id: "business_balanced",
            title: "Business balanced (top leg ≤ 80%)",
            ok: topLegOk,
            detail: topLegDetail,
        },
        {
            id: "active_members",
            title: "Active members (direct/indirect)",
            ok: activeOk,
            detail: `${metrics.activeCount} active (need ≥${activeNeed} total, ≥${first.direct} active L1). Bet ≥₹150 in last 24h.`,
        },
        {
            id: "shared_ip",
            title: "Shared-IP accounts",
            ok: sharedIpOk,
            detail: sharedIpDetail,
        },
        {
            id: "shared_bank",
            title: "Shared bank accounts",
            ok: sharedBankOk,
            detail: sharedBankDetail,
        },
        {
            id: "cross_trading",
            title: "Cross-trading",
            ok: crossOk,
            detail: crossDetail,
        },
    ];
}

function howtoSteps(metrics: SalaryMetrics) {
    const first = AUTO_SALARY_SLABS[0]!;
    const steps: { id: string; title: string; body: string }[] = [];

    if (metrics.directCount < first.direct) {
        const n = first.direct - metrics.directCount;
        steps.push({
            id: "direct",
            title: `Get ${n} more active direct${n > 1 ? "s" : ""}`,
            body: `${n} more Level-1 member${n > 1 ? "s" : ""} must bet at least ₹150 in the last 24 hours. Empty invites do not count.`,
        });
    }
    const firstActiveNeed = slabRequiredActive(first);
    if (metrics.activeCount < firstActiveNeed) {
        const n = firstActiveNeed - metrics.activeCount;
        steps.push({
            id: "active",
            title: `Get ${n} more active member${n > 1 ? "s" : ""}`,
            body: `Need ${firstActiveNeed} actives in total (≥${first.direct} L1). Extra can be more directs or L2–L6. Each must bet ≥₹150 in 24h (WinGo / TRX / K3 / 5D / Moto). Demo accounts do not count.`,
        });
    }
    if (metrics.teamDeposit < first.teamDeposit) {
        const need = first.teamDeposit - metrics.teamDeposit;
        steps.push({
            id: "deposit",
            title: `Bring ₹${need.toLocaleString("en-IN")} more team deposit`,
            body: `Your team needs ₹${need.toLocaleString("en-IN")} more in deposits today (IST). Only today's deposits count toward today's slab.`,
        });
    }
    if (steps.length === 0) {
        const match = matchHighestSlab(metrics);
        const nextIdx = (match?.slabIndex ?? -1) + 1;
        const next = AUTO_SALARY_SLABS[nextIdx];
        if (next) {
            steps.push({
                id: "next_slab",
                title: `Next level ₹${next.reward.toLocaleString("en-IN")}/day`,
                body: `Need ${Math.max(0, next.direct - metrics.directCount)} more active L1, ${Math.max(0, slabRequiredActive(next) - metrics.activeCount)} more active in the team, ₹${Math.max(0, next.teamDeposit - metrics.teamDeposit).toLocaleString("en-IN")} more team deposit today.`,
            });
        } else {
            steps.push({
                id: "max",
                title: "Highest salary level reached",
                body: "You meet the top slab requirements for today. Keep the team active to stay eligible.",
            });
        }
    }
    return steps;
}

export const userSalaryRoutes = (app: OpenAPIHono) => {
    app.openapi(salaryDashboardRoute, async (c) => {
        try {
            const user = c.get("user");
            const cacheKey = `user:salary-dashboard:${user.id}`;
            const cached = await Cache.get<Record<string, unknown>>(cacheKey);
            if (cached) {
                return c.json({ success: true, data: cached }, HTTP_STATUS.OK);
            }

            const todayYmd = formatIstYmd(new Date());
            const yestYmd = shiftIstYmd(todayYmd, -1);
            const dayBeforeYmd = shiftIstYmd(todayYmd, -2);

            const [todayM, yestM, dbyM, teamMembers, claimToday, claimYest] =
                await Promise.all([
                    dayMetrics(user.id, todayYmd),
                    dayMetrics(user.id, yestYmd),
                    dayMetrics(user.id, dayBeforeYmd),
                    TeamMetricsCalculator.getTeamMembers(user.id, 6),
                    prisma.autoSalaryClaim.findUnique({
                        where: {
                            userId_periodDate: {
                                userId: user.id,
                                periodDate: getIstDayRange(todayYmd).periodDate,
                            },
                        },
                    }),
                    prisma.autoSalaryClaim.findUnique({
                        where: {
                            userId_periodDate: {
                                userId: user.id,
                                periodDate: getIstDayRange(yestYmd).periodDate,
                            },
                        },
                    }),
                ]);

            const eligibility = await buildEligibility(user.id, todayM);
            const teamSize = teamMembers.length;

            const match = matchHighestSlab(todayM);
            const allEligibilityOk = eligibility.every((e) => e.ok);
            const projected = match && allEligibilityOk ? match.amount : 0;

            // Lifetime credited (admin-approved auto salary)
            const [lifetimeAgg, pendingAgg] = await Promise.all([
                prisma.autoSalaryClaim.aggregate({
                    where: { userId: user.id, status: "APPROVED" },
                    _sum: { amount: true },
                    _count: { _all: true },
                }),
                prisma.autoSalaryClaim.aggregate({
                    where: { userId: user.id, status: "PENDING" },
                    _sum: { amount: true },
                    _count: { _all: true },
                }),
            ]);
            const totalReceived = lifetimeAgg._sum.amount ?? 0;
            const pendingTotal = pendingAgg._sum.amount ?? 0;

            // Prefer explicit claim for display so user can show CS the same figure admin sees
            let willReceive = projected;
            let status: "eligible" | "on_hold" | "pending" | "paid" | "none" =
                "none";
            let statusLabel =
                "Meet a salary level below to start earning daily salary";

            if (claimToday?.status === "APPROVED") {
                status = "paid";
                statusLabel = "Credited for today — already in your wallet";
                willReceive = claimToday.amount;
            } else if (claimToday?.status === "PENDING") {
                status = "pending";
                statusLabel =
                    "Pending admin approval — same claim appears for admin review";
                willReceive = claimToday.amount;
            } else if (claimYest?.status === "PENDING" && !claimToday) {
                // After midnight, yesterday's generated claim is what admin usually approves
                status = "pending";
                statusLabel =
                    "Yesterday's salary pending admin approval — contact CS with this amount if delayed";
                willReceive = claimYest.amount;
            } else if (claimYest?.status === "APPROVED" && !claimToday) {
                status = "paid";
                statusLabel = "Yesterday's salary credited";
                willReceive = claimYest.amount;
            } else if (match && allEligibilityOk) {
                status = "eligible";
                statusLabel =
                    "Eligible for today's slab — claim generates after day ends (IST)";
                willReceive = projected;
            } else if (match && !allEligibilityOk) {
                status = "on_hold";
                statusLabel = "On hold — complete eligibility steps below";
                willReceive = 0;
            } else {
                status = "on_hold";
                statusLabel = "On hold — complete the steps below";
                willReceive = 0;
            }

            const slabs = AUTO_SALARY_SLABS.map((s, i) => ({
                index: i,
                reward: s.reward,
                direct: s.direct,
                active: s.active,
                teamDeposit: s.teamDeposit,
                unlocked: slabMet(todayM, s),
            }));

            const nextSlab =
                match == null
                    ? AUTO_SALARY_SLABS[0]!
                    : AUTO_SALARY_SLABS[match.slabIndex + 1] ?? null;

            const mapClaim = (
                c: NonNullable<typeof claimToday> | NonNullable<typeof claimYest>
            ) => ({
                id: c.id,
                amount: c.amount,
                status: c.status,
                periodDate: formatIstYmd(c.periodDate),
                slabIndex: c.slabIndex,
                directCount: c.directCount,
                activeCount: c.activeCount,
                teamDeposit: c.teamDeposit,
                reviewedAt: c.reviewedAt?.toISOString() ?? null,
                createdAt: c.createdAt.toISOString(),
            });

            const data = {
                timezone: "Asia/Kolkata",
                todayYmd,
                willReceive,
                /** Lifetime wallet-credited auto salary (APPROVED claims) */
                totalReceived,
                pendingTotal,
                pendingCount: pendingAgg._count._all,
                approvedCount: lifetimeAgg._count._all,
                status,
                statusLabel,
                metrics: {
                    direct: todayM.directCount,
                    teamL1to6: teamSize,
                    active: todayM.activeCount,
                    yesterdaySalary: claimYest?.amount ?? 0,
                    yesterdaySalaryStatus: claimYest?.status ?? null,
                    todayTeamDeposit: todayM.teamDeposit,
                    yesterdayTeamDeposit: yestM.teamDeposit,
                    dayBeforeTeamDeposit: dbyM.teamDeposit,
                },
                slabs,
                matchedSlab: match
                    ? {
                          index: match.slabIndex,
                          reward: match.amount,
                          direct: match.slab.direct,
                          active: match.slab.active,
                          teamDeposit: match.slab.teamDeposit,
                      }
                    : null,
                nextSlab: nextSlab
                    ? {
                          reward: nextSlab.reward,
                          directNeed: Math.max(
                              0,
                              nextSlab.direct - todayM.directCount
                          ),
                          activeNeed: Math.max(
                              0,
                              slabRequiredActive(nextSlab) - todayM.activeCount
                          ),
                          depositNeed: Math.max(
                              0,
                              nextSlab.teamDeposit - todayM.teamDeposit
                          ),
                      }
                    : null,
                eligibility,
                howto: howtoSteps(todayM),
                claim: claimToday ? mapClaim(claimToday) : null,
                yesterdayClaim: claimYest ? mapClaim(claimYest) : null,
            };

            // Short cache — live progress
            await Cache.set(cacheKey, data, 60);

            return c.json({ success: true, data }, HTTP_STATUS.OK);
        } catch (error) {
            logger.error(error);
            return apiError(
                c,
                "Internal server error",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.openapi(getUserSalaryRoute, async (c) => {
        try {
            const user = c.get("user");
            const { page, limit, startDate, endDate, status, creditedOnly } =
                c.req.valid("query");
            const skip = (page - 1) * limit;
            const onlyCredited = creditedOnly === "true";

            const cacheKey = CacheKey.userSalaryHistory(user.id);
            const fieldKey = `v2-page:${page}-limit:${limit}-s:${startDate || "x"}-e:${endDate || "x"}-st:${status || "ALL"}-cr:${onlyCredited}`;

            type ClaimRow = {
                id: string;
                amount: number;
                periodDate: string;
                status: "PENDING" | "APPROVED" | "REJECTED";
                slabIndex: number;
                directCount: number;
                activeCount: number;
                teamDeposit: number;
                rejectReason?: string | null;
                reviewedAt?: string | null;
                createdAt: string;
                note?: string;
            };

            const cached = await Cache.hget<{
                claims: ClaimRow[];
                payments: Array<{
                    id: string;
                    amount: number;
                    createdAt: string;
                    note?: string;
                    status?: "PENDING" | "APPROVED" | "REJECTED";
                    periodDate?: string;
                }>;
                total: number;
                currentPage: number;
                totalPages: number;
                summary: {
                    totalReceived: number;
                    totalAmount: number;
                    pendingTotal: number;
                    credits: number;
                    pendingCount: number;
                };
            }>(cacheKey, fieldKey);
            if (cached) {
                return c.json({ success: true, ...cached }, HTTP_STATUS.OK);
            }

            const where: {
                userId: string;
                status?: "PENDING" | "APPROVED" | "REJECTED";
                periodDate?: { gte?: Date; lte?: Date };
            } = { userId: user.id };

            if (onlyCredited) {
                where.status = "APPROVED";
            } else if (status && status !== "ALL") {
                where.status = status;
            }

            if (startDate || endDate) {
                where.periodDate = {};
                if (startDate) {
                    where.periodDate.gte = getIstDayRange(startDate).periodDate;
                }
                if (endDate) {
                    where.periodDate.lte = getIstDayRange(endDate).periodDate;
                }
            }

            const [claims, total, approvedAgg, pendingAgg, manualPayments, manualAgg] = await Promise.all([
                prisma.autoSalaryClaim.findMany({
                    where,
                    take: limit,
                    skip,
                    orderBy: [{ periodDate: "desc" }, { createdAt: "desc" }],
                }),
                prisma.autoSalaryClaim.count({ where }),
                prisma.autoSalaryClaim.aggregate({
                    where: {
                        userId: user.id,
                        status: "APPROVED",
                        ...(where.periodDate
                            ? { periodDate: where.periodDate }
                            : {}),
                    },
                    _sum: { amount: true },
                    _count: { _all: true },
                }),
                prisma.autoSalaryClaim.aggregate({
                    where: {
                        userId: user.id,
                        status: "PENDING",
                        ...(where.periodDate
                            ? { periodDate: where.periodDate }
                            : {}),
                    },
                    _sum: { amount: true },
                    _count: { _all: true },
                }),
                prisma.salaryPayment.findMany({
                    where: {
                        userId: user.id,
                        ...(startDate || endDate
                            ? {
                                  createdAt: {
                                      ...(startDate ? { gte: new Date(startDate) } : {}),
                                      ...(endDate ? { lte: new Date(endDate) } : {}),
                                  },
                              }
                            : {}),
                    },
                    orderBy: { createdAt: "desc" },
                    take: limit,
                }),
                prisma.salaryPayment.aggregate({
                    where: {
                        userId: user.id,
                        ...(startDate || endDate
                            ? {
                                  createdAt: {
                                      ...(startDate ? { gte: new Date(startDate) } : {}),
                                      ...(endDate ? { lte: new Date(endDate) } : {}),
                                  },
                              }
                            : {}),
                    },
                    _sum: { amount: true },
                    _count: { _all: true },
                }),
            ]);

            const totalPages = Math.max(1, Math.ceil(total / limit));

            const mapped: ClaimRow[] = claims.map((c) => {
                const period = formatIstYmd(c.periodDate);
                const note =
                    c.status === "APPROVED"
                        ? `Auto salary ${period} · credited`
                        : c.status === "PENDING"
                          ? `Auto salary ${period} · pending admin approval`
                          : `Auto salary ${period} · rejected${c.rejectReason ? `: ${c.rejectReason}` : ""}`;
                return {
                    id: c.id,
                    amount: c.amount,
                    periodDate: period,
                    status: c.status as "PENDING" | "APPROVED" | "REJECTED",
                    slabIndex: c.slabIndex,
                    directCount: c.directCount,
                    activeCount: c.activeCount,
                    teamDeposit: c.teamDeposit,
                    rejectReason: c.rejectReason,
                    reviewedAt: c.reviewedAt?.toISOString() ?? null,
                    createdAt: c.createdAt.toISOString(),
                    note,
                };
            });

            const autoPayments = (
                onlyCredited
                    ? mapped.filter((c) => c.status === "APPROVED")
                    : mapped
            ).map((c) => ({
                id: c.id,
                amount: c.amount,
                createdAt:
                    c.status === "APPROVED" && c.reviewedAt
                        ? c.reviewedAt
                        : c.createdAt,
                note: c.note,
                status: c.status,
                periodDate: c.periodDate,
            }));

            const manualMapped = manualPayments.map((p) => ({
                id: `manual-${p.id}`,
                amount: p.amount,
                createdAt: p.createdAt.toISOString(),
                note: p.remark || "Salary credited by admin",
                status: "APPROVED" as const,
                periodDate: undefined,
            }));

            const payments = [...autoPayments, ...manualMapped].sort(
                (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );

            const totalReceived = (approvedAgg._sum.amount ?? 0) + (manualAgg._sum.amount ?? 0);
            const pendingTotal = pendingAgg._sum.amount ?? 0;
            const totalCredits = (approvedAgg._count._all ?? 0) + (manualAgg._count._all ?? 0);

            const result = {
                claims: mapped,
                payments,
                total,
                currentPage: page,
                totalPages,
                summary: {
                    totalReceived,
                    totalAmount: totalReceived,
                    pendingTotal,
                    credits: totalCredits,
                    pendingCount: pendingAgg._count._all,
                },
            };

            await Cache.hset(cacheKey, fieldKey, result, 60 * 2);

            return c.json({ success: true, ...result }, HTTP_STATUS.OK);
        } catch (error) {
            logger.error(error);
            return apiError(
                c,
                "Internal server error",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
