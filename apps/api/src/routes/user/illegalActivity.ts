import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { getUserWagerStatusReadOnly } from "@bcwin/wager";
import { authCookie } from "@/schemas";
import { apiError, CommonResponses } from "@/lib/utils";
import { HTTP_STATUS } from "@/lib/http";

const logger = new Logger("user-illegal-activity");
const entrySchema = z.object({
    id: z.string(), action: z.string(), reason: z.string(), legacy: z.boolean(),
    game: z.string().nullable(), periodNumber: z.string().nullable(), createdAt: z.string(),
    evidence: z.array(z.object({
        id: z.string(), selection: z.string(), amount: z.number(),
        betType: z.string().optional(), scope: z.string().nullable().optional(),
        recordedStakeOnly: z.boolean().optional(),
    })),
    previousFactor: z.number().nullable(), resultingFactor: z.number().nullable(),
    beforeNeedToBet: z.number().nullable(), afterNeedToBet: z.number().nullable(),
    beforePenaltyWager: z.number().nullable(), afterPenaltyWager: z.number().nullable(),
    beforeRewardWager: z.number().nullable(), afterRewardWager: z.number().nullable(),
});
const route = createRoute({
    method: "get", path: "/illegal-activity", tags: ["user"],
    summary: "Own penalty applications, adjustments and legacy evidence",
    request: { cookies: authCookie, query: z.object({
        page: z.coerce.number().int().min(1).max(50).default(1),
        limit: z.coerce.number().int().min(1).max(20).default(20),
        reason: z.enum(["ALL", "ILLEGAL_BETS", "SAME_IP", "ADMIN"]).default("ALL"),
        startDate: z.string().date().optional(), endDate: z.string().date().optional(),
        asOf: z.string().datetime().optional(),
    }).refine((q) => !q.startDate || !q.endDate || q.startDate <= q.endDate, {
        message: "Start date must not be after end date", path: ["endDate"],
    }) },
    responses: {
        200: { description: "Private penalty history", content: { "application/json": { schema: z.object({
            success: z.literal(true), items: z.array(entrySchema), total: z.number(),
            currentPage: z.number(), totalPages: z.number(), asOf: z.string(),
            current: z.object({ penaltyWagerNeeded: z.number(), totalNeedToBet: z.number() }),
        }) } } },
        ...CommonResponses.badRequest(), ...CommonResponses.internalServerError(),
    },
});

export function illegalActivityRoutes(app: OpenAPIHono) {
    app.openapi(route, async (c) => {
        try {
            c.header("Cache-Control", "private, no-store");
            const userId = c.get("user").id;
            const { page, limit, reason, startDate, endDate, asOf } = c.req.valid("query");
            const cutoff = new Date(Math.min(Date.now(), asOf ? Date.parse(asOf) : Date.now()));
            const start = startDate ? new Date(`${startDate}T00:00:00+05:30`) : null;
            const end = endDate ? new Date(new Date(`${endDate}T00:00:00+05:30`).getTime() + 86_400_000) : null;
            // New events suppress their original audit rows. Older writers remain visible as partial evidence.
            const [result] = await prisma.$queryRaw<Array<{ total: number; items: z.infer<typeof entrySchema>[] }>>`
                WITH old_bets AS (
                    SELECT b.*, CASE WHEN b."penaltyEventKey" IS NULL THEN 'legacy:' || b.id
                        ELSE split_part(b."penaltyEventKey", ':', 1) || ':' ||
                             split_part(b."penaltyEventKey", ':', 2) || ':' ||
                             split_part(b."penaltyEventKey", ':', 3) || ':' END AS round_key
                    FROM "IllegalBet" b WHERE b."userId" = ${userId}
                ), history AS (
                    SELECT e.id, e."createdAt", e.reason,
                        jsonb_build_object(
                            'id', e.id, 'action', e.action, 'reason', e.reason, 'legacy', false,
                            'game', e.game, 'periodNumber', e."periodNumber",
                            'evidence', COALESCE(e.evidence, '[]'::jsonb),
                            'previousFactor', e."previousFactor", 'resultingFactor', e."resultingFactor",
                            'beforeNeedToBet', e."beforeNeedToBet", 'afterNeedToBet', e."afterNeedToBet",
                            'beforePenaltyWager', e."beforePenaltyWager", 'afterPenaltyWager', e."afterPenaltyWager",
                            'beforeRewardWager', e."beforeRewardWager", 'afterRewardWager', e."afterRewardWager"
                        ) AS item
                    FROM "PenaltyHistoryEvent" e WHERE e."userId" = ${userId}
                    UNION ALL
                    SELECT 'bet:' || b.round_key, MIN(b."createdAt"), 'ILLEGAL_BETS',
                        jsonb_build_object(
                            'id', 'bet:' || b.round_key, 'action', 'DETECTED', 'reason', 'ILLEGAL_BETS', 'legacy', true,
                            'game', MIN(b."betGame"), 'periodNumber', NULL,
                            'evidence', jsonb_agg(jsonb_build_object('id', b.id, 'selection', b."betType",
                                'amount', b."betAmount", 'recordedStakeOnly', true) ORDER BY b."createdAt", b.id),
                            'previousFactor', NULL, 'resultingFactor', NULL,
                            'beforeNeedToBet', NULL, 'afterNeedToBet', NULL,
                            'beforePenaltyWager', NULL, 'afterPenaltyWager', NULL,
                            'beforeRewardWager', NULL, 'afterRewardWager', NULL
                        )
                    FROM old_bets b WHERE NOT EXISTS (
                        SELECT 1 FROM "PenaltyHistoryEvent" e WHERE e."userId" = ${userId} AND e."eventKey" = b.round_key
                    ) GROUP BY b.round_key
                    UNION ALL
                    SELECT 'clear:' || w.id, w."createdAt", 'ADMIN', jsonb_build_object(
                        'id', 'clear:' || w.id, 'action', 'EXTRA_WAGERS_CLEARED', 'reason', 'ADMIN', 'legacy', true,
                        'game', NULL, 'periodNumber', NULL, 'evidence', '[]'::jsonb,
                        'previousFactor', w."previousPenaltyFactor", 'resultingFactor', w."baseWagerFactor",
                        'beforeNeedToBet', NULL, 'afterNeedToBet', NULL,
                        'beforePenaltyWager', NULL, 'afterPenaltyWager', NULL,
                        'beforeRewardWager', w."beforeRewardWagerNeeded", 'afterRewardWager', w."afterRewardWagerNeeded"
                    ) FROM "WagerClearEvent" w WHERE w."userId" = ${userId} AND NOT EXISTS (
                        SELECT 1 FROM "PenaltyHistoryEvent" e WHERE e."userId" = ${userId} AND e."eventKey" = 'clear:' || w.id
                    )
                ), filtered AS MATERIALIZED (
                    SELECT * FROM history WHERE (${reason} = 'ALL' OR reason = ${reason})
                        AND "createdAt" <= ${cutoff}
                        AND (${start}::timestamp IS NULL OR "createdAt" >= ${start})
                        AND (${end}::timestamp IS NULL OR "createdAt" < ${end})
                ), page_rows AS (
                    SELECT * FROM filtered ORDER BY "createdAt" DESC, id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}
                )
                SELECT (SELECT COUNT(*)::int FROM filtered) AS total,
                    COALESCE(jsonb_agg(item || jsonb_build_object('createdAt',
                        to_char("createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
                        ORDER BY "createdAt" DESC, id DESC), '[]'::jsonb) AS items
                FROM page_rows
            `;
            const current = await getUserWagerStatusReadOnly(userId);
            return c.json({
                success: true as const, items: result.items, total: result.total,
                currentPage: page, totalPages: Math.min(50, Math.max(1, Math.ceil(result.total / limit))),
                asOf: cutoff.toISOString(),
                current: { penaltyWagerNeeded: current.penaltyWagerNeeded, totalNeedToBet: current.totalNeedToBet },
            }, HTTP_STATUS.OK);
        } catch (error) {
            logger.error(error);
            return apiError(c, "Unable to load illegal activity", HTTP_STATUS.INTERNAL_SERVER_ERROR);
        }
    });
}
