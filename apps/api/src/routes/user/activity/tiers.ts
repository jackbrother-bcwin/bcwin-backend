import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import { activityBonusTypeSchema } from "@/schemas/activity";
import { WEEKLY_REQUIREMENT_SCALE } from "@bcwin/activity-bonus";

const logger = new Logger("activity-tiers");

const activityTierSchema = z.object({
    id: z.string().uuid(),
    type: activityBonusTypeSchema,
    depositRequirement: z.number().nullable(),
    betRequirement: z.number().nullable(),
    inviteRequirement: z.number().nullable(),
    dayRequirement: z.number().nullable(),
    reward: z.number(),
});

const activityTiersResponseSchema = z.object({
    success: z.boolean(),
    data: z.object({
        weekly: z.array(activityTierSchema).describe("Weekly bonus tiers ordered by betRequirement"),
        daily: z.array(activityTierSchema).describe("Daily bonus tiers ordered by depositRequirement"),
        invitation: z.array(activityTierSchema).describe("Invitation bonus tiers ordered by inviteRequirement"),
        firstDeposit: z.array(activityTierSchema).describe("First deposit bonus tiers ordered by depositRequirement"),
        attendance: z.array(activityTierSchema).describe("Attendance bonus tiers ordered by dayRequirement"),
        winStreak: z.array(
            z.object({
                id: z.string().uuid(),
                consecutiveWins: z.number().int(),
                bonusPercentage: z.number(),
            })
        ).describe("Win streak bonus rules ordered by consecutiveWins"),
    }),
});

const getTiersQuerySchema = z.object({
    type: activityBonusTypeSchema.optional().openapi({
        description: "Filter by a specific bonus type. Returns all types if omitted.",
    }),
});

const getActivityTiersRoute = createRoute({
    method: "get",
    tags: ["user"],
    path: "/tiers",
    summary: "Get activity bonus tier configuration",
    description:
        "Returns all admin-configured activity bonus tier requirements and rewards so the frontend can display the rules table.",
    request: {
        cookies: authCookie,
        query: getTiersQuerySchema,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: activityTiersResponseSchema,
                },
            },
            description: "Successfully retrieved activity bonus tiers",
        },
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

export const activityTiersRoutes = (app: OpenAPIHono) => {
    app.openapi(getActivityTiersRoute, async (c) => {
        try {
            // Fetch all tier types + win streak rules in parallel
            const [
                weeklyTiers,
                dailyTiers,
                invitationTiers,
                firstDepositTiers,
                attendanceTiers,
                winStreakRules,
            ] = await Promise.all([
                prisma.activityBonusTier.findMany({
                    where: { type: "WEEKLY" },
                    orderBy: { betRequirement: "asc" },
                    select: {
                        id: true,
                        type: true,
                        depositRequirement: true,
                        betRequirement: true,
                        inviteRequirement: true,
                        dayRequirement: true,
                        reward: true,
                    },
                }),
                prisma.activityBonusTier.findMany({
                    where: { type: "DAILY" },
                    orderBy: [
                        { depositRequirement: "asc" },
                        { betRequirement: "asc" },
                    ],
                    select: {
                        id: true,
                        type: true,
                        depositRequirement: true,
                        betRequirement: true,
                        inviteRequirement: true,
                        dayRequirement: true,
                        reward: true,
                    },
                }),
                prisma.activityBonusTier.findMany({
                    where: { type: "INVITATION" },
                    orderBy: [
                        { inviteRequirement: "asc" },
                        { depositRequirement: "asc" },
                    ],
                    select: {
                        id: true,
                        type: true,
                        depositRequirement: true,
                        betRequirement: true,
                        inviteRequirement: true,
                        dayRequirement: true,
                        reward: true,
                    },
                }),
                prisma.activityBonusTier.findMany({
                    where: { type: "FIRST_DEPOSIT" },
                    orderBy: { depositRequirement: "asc" },
                    select: {
                        id: true,
                        type: true,
                        depositRequirement: true,
                        betRequirement: true,
                        inviteRequirement: true,
                        dayRequirement: true,
                        reward: true,
                    },
                }),
                prisma.activityBonusTier.findMany({
                    where: { type: "ATTENDENCE" },
                    orderBy: { dayRequirement: "asc" },
                    select: {
                        id: true,
                        type: true,
                        depositRequirement: true,
                        betRequirement: true,
                        inviteRequirement: true,
                        dayRequirement: true,
                        reward: true,
                    },
                }),
                prisma.winStreakRule.findMany({
                    where: { isActive: true },
                    orderBy: { consecutiveWins: "asc" },
                    select: {
                        id: true,
                        consecutiveWins: true,
                        bonusPercentage: true,
                    },
                }),
            ]);

            // Scale weekly betRequirement (doubled during client pause)
            const weeklyScaled = weeklyTiers.map((t) => ({
                ...t,
                betRequirement:
                    (t.betRequirement || 0) * WEEKLY_REQUIREMENT_SCALE,
            }));

            return c.json(
                {
                    success: true,
                    data: {
                        weekly: weeklyScaled,
                        daily: dailyTiers,
                        invitation: invitationTiers,
                        firstDeposit: firstDepositTiers,
                        attendance: attendanceTiers,
                        winStreak: winStreakRules,
                    },
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error fetching activity tiers:", error);
            return apiError(
                c,
                "Failed to fetch activity tiers",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};
