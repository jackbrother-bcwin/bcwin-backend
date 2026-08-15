import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";
import { prisma } from "@bcwin/db";
import { authCookie } from "@/schemas";
import {
    getWinStreakRulesResponseSchema,
    createWinStreakRuleBodySchema,
    createWinStreakRuleResponseSchema,
    updateWinStreakRuleBodySchema,
    deleteWinStreakRuleResponseSchema,
} from "@/schemas/admin/winStreakRules";

const formatRule = (rule: {
    id: string;
    consecutiveWins: number;
    bonusPercentage: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}) => ({
    ...rule,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
});

export const winStreakRulesRoutes = (app: OpenAPIHono) => {
    // GET all rules
    app.openapi(
        createRoute({
            method: "get",
            path: "/",
            tags: ["Admin Win Streak"],
            summary: "Get all win streak bonus rules",
            request: {
                cookies: authCookie,
            },
            responses: {
                200: {
                    description: "Win streak rules fetched successfully",
                    content: {
                        "application/json": {
                            schema: getWinStreakRulesResponseSchema,
                        },
                    },
                },
            },
        }),
        async (c) => {
            const rules = await prisma.winStreakRule.findMany({
                orderBy: { consecutiveWins: "asc" },
            });

            return c.json(
                {
                    success: true,
                    data: rules.map(formatRule),
                },
                200
            );
        }
    );

    // POST create a rule
    app.openapi(
        createRoute({
            method: "post",
            path: "/",
            tags: ["Admin Win Streak"],
            summary: "Create a win streak bonus rule",
            request: {
                cookies: authCookie,
                body: {
                    content: {
                        "application/json": {
                            schema: createWinStreakRuleBodySchema,
                        },
                    },
                },
            },
            responses: {
                201: {
                    description: "Rule created successfully",
                    content: {
                        "application/json": {
                            schema: createWinStreakRuleResponseSchema,
                        },
                    },
                },
                409: {
                    description: "A rule with this consecutiveWins count already exists",
                },
            },
        }),
        async (c) => {
            const body = c.req.valid("json");

            // Check uniqueness
            const existing = await prisma.winStreakRule.findUnique({
                where: { consecutiveWins: body.consecutiveWins },
            });

            if (existing) {
                return c.json(
                    {
                        success: false,
                        message: `A rule for ${body.consecutiveWins} consecutive wins already exists`,
                    },
                    409 as any
                );
            }

            const rule = await prisma.winStreakRule.create({
                data: {
                    consecutiveWins: body.consecutiveWins,
                    bonusPercentage: body.bonusPercentage,
                    isActive: body.isActive ?? true,
                },
            });

            return c.json(
                {
                    success: true,
                    message: "Win streak rule created successfully",
                    data: formatRule(rule),
                },
                201
            );
        }
    );

    // PATCH update a rule (partial update)
    app.openapi(
        createRoute({
            method: "patch",
            path: "/:id",
            tags: ["Admin Win Streak"],
            summary: "Update a win streak bonus rule",
            request: {
                cookies: authCookie,
                params: z.object({ id: z.string().uuid() }),
                body: {
                    content: {
                        "application/json": {
                            schema: updateWinStreakRuleBodySchema,
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: "Rule updated successfully",
                    content: {
                        "application/json": {
                            schema: createWinStreakRuleResponseSchema,
                        },
                    },
                },
                404: { description: "Rule not found" },
            },
        }),
        async (c) => {
            const { id } = c.req.valid("param");
            const body = c.req.valid("json");

            const existing = await prisma.winStreakRule.findUnique({
                where: { id },
            });

            if (!existing) {
                return c.json(
                    { success: false, message: "Win streak rule not found" },
                    404 as any
                );
            }

            const rule = await prisma.winStreakRule.update({
                where: { id },
                data: {
                    bonusPercentage: body.bonusPercentage,
                    isActive: body.isActive,
                },
            });

            return c.json(
                {
                    success: true,
                    message: "Win streak rule updated successfully",
                    data: formatRule(rule),
                },
                200
            );
        }
    );

    // DELETE a rule
    app.openapi(
        createRoute({
            method: "delete",
            path: "/:id",
            tags: ["Admin Win Streak"],
            summary: "Delete a win streak bonus rule",
            request: {
                cookies: authCookie,
                params: z.object({ id: z.string().uuid() }),
            },
            responses: {
                200: {
                    description: "Rule deleted successfully",
                    content: {
                        "application/json": {
                            schema: deleteWinStreakRuleResponseSchema,
                        },
                    },
                },
                404: { description: "Rule not found" },
            },
        }),
        async (c) => {
            const { id } = c.req.valid("param");

            const existing = await prisma.winStreakRule.findUnique({
                where: { id },
            });

            if (!existing) {
                return c.json(
                    { success: false, message: "Win streak rule not found" },
                    404 as any
                );
            }

            await prisma.winStreakRule.delete({ where: { id } });

            return c.json(
                {
                    success: true,
                    message: "Win streak rule deleted successfully",
                },
                200
            );
        }
    );
};
