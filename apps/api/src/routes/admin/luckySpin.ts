import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { prisma } from "@bcwin/db";
import { authCookie } from "@/schemas";
import { z } from "zod";
import {
    getLuckySpinRulesResponseSchema,
    createLuckySpinRuleBodySchema,
    luckySpinRuleResponseSchema,
    updateLuckySpinRuleBodySchema,
    getLuckySpinRewardsResponseSchema,
    createLuckySpinRewardBodySchema,
    luckySpinRewardResponseSchema,
    updateLuckySpinRewardBodySchema,
    deleteResponseSchema,
} from "../../schemas/admin/luckySpin";

export const luckySpinAdminRoutes = (app: OpenAPIHono) => {
    // --- RULES ---

    // GET all rules
    app.openapi(
        createRoute({
            method: "get",
            path: "/lucky-spin/rules",
            tags: ["admin"],
            summary: "Get all lucky spin rules",
            description: "Retrieve all rules governing extra spin chances. A rule defines the minimum cumulative deposit (`minDeposit`) a user must make in a day to receive a specific number of extra spins (`spinChances`). Rules with `isActive: true` are evaluated daily.",
            request: {
                cookies: authCookie,
            },
            responses: {
                200: {
                    description: "Lucky spin rules fetched successfully",
                    content: {
                        "application/json": {
                            schema: getLuckySpinRulesResponseSchema,
                        },
                    },
                },
            },
        }),
        async (c) => {
            const rules = await prisma.luckySpinRule.findMany({
                orderBy: { minDeposit: "asc" },
            });

            return c.json(
                {
                    success: true,
                    data: rules.map((r) => ({
                        ...r,
                        createdAt: r.createdAt.toISOString(),
                        updatedAt: r.updatedAt.toISOString(),
                    })),
                },
                200
            );
        }
    );

    // POST create rule
    app.openapi(
        createRoute({
            method: "post",
            path: "/lucky-spin/rules",
            tags: ["admin"],
            summary: "Create a new lucky spin rule",
            description: "Create a new rule specifying the `minDeposit` required to grant `spinChances` extra spins to a user.",
            request: {
                cookies: authCookie,
                body: {
                    content: {
                        "application/json": {
                            schema: createLuckySpinRuleBodySchema,
                        },
                    },
                },
            },
            responses: {
                201: {
                    description: "Rule created successfully",
                    content: {
                        "application/json": {
                            schema: luckySpinRuleResponseSchema,
                        },
                    },
                },
            },
        }),
        async (c) => {
            const body = c.req.valid("json");

            const rule = await prisma.luckySpinRule.create({
                data: body,
            });

            return c.json(
                {
                    success: true,
                    message: "Rule created successfully",
                    data: {
                        ...rule,
                        createdAt: rule.createdAt.toISOString(),
                        updatedAt: rule.updatedAt.toISOString(),
                    },
                },
                201
            );
        }
    );

    // PATCH update rule
    app.openapi(
        createRoute({
            method: "patch",
            path: "/lucky-spin/rules/{id}",
            tags: ["admin"],
            summary: "Update a lucky spin rule",
            description: "Modify an existing lucky spin rule (e.g., to adjust the `minDeposit` threshold or toggle `isActive`).",
            request: {
                cookies: authCookie,
                params: z.object({ id: z.string().uuid() }),
                body: {
                    content: {
                        "application/json": {
                            schema: updateLuckySpinRuleBodySchema,
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: "Rule updated successfully",
                    content: {
                        "application/json": {
                            schema: luckySpinRuleResponseSchema,
                        },
                    },
                },
                404: {
                    description: "Rule not found",
                },
            },
        }),
        async (c) => {
            const { id } = c.req.valid("param");
            const body = c.req.valid("json");

            const existing = await prisma.luckySpinRule.findUnique({
                where: { id },
            });

            if (!existing) {
                return c.json({ success: false, message: "Rule not found" }, 404 as any);
            }

            const rule = await prisma.luckySpinRule.update({
                where: { id },
                data: body,
            });

            return c.json(
                {
                    success: true,
                    message: "Rule updated successfully",
                    data: {
                        ...rule,
                        createdAt: rule.createdAt.toISOString(),
                        updatedAt: rule.updatedAt.toISOString(),
                    },
                },
                200
            );
        }
    );

    // DELETE rule
    app.openapi(
        createRoute({
            method: "delete",
            path: "/lucky-spin/rules/{id}",
            tags: ["admin"],
            summary: "Delete a lucky spin rule",
            description: "Permanently delete a lucky spin rule.",
            request: {
                cookies: authCookie,
                params: z.object({ id: z.string().uuid() }),
            },
            responses: {
                200: {
                    description: "Rule deleted successfully",
                    content: {
                        "application/json": {
                            schema: deleteResponseSchema,
                        },
                    },
                },
                404: {
                    description: "Rule not found",
                },
            },
        }),
        async (c) => {
            const { id } = c.req.valid("param");

            const existing = await prisma.luckySpinRule.findUnique({
                where: { id },
            });

            if (!existing) {
                return c.json({ success: false, message: "Rule not found" }, 404 as any);
            }

            await prisma.luckySpinRule.delete({ where: { id } });

            return c.json(
                { success: true, message: "Rule deleted successfully" },
                200
            );
        }
    );

    // --- REWARDS ---

    // GET all rewards
    app.openapi(
        createRoute({
            method: "get",
            path: "/lucky-spin/rewards",
            tags: ["admin"],
            summary: "Get all lucky spin rewards",
            description: "Retrieve all possible rewards a user can win when spinning the wheel. The winning amount is chosen using weighted random probability based on the `probability` field (higher value = more likely to be selected).",
            request: {
                cookies: authCookie,
            },
            responses: {
                200: {
                    description: "Lucky spin rewards fetched successfully",
                    content: {
                        "application/json": {
                            schema: getLuckySpinRewardsResponseSchema,
                        },
                    },
                },
            },
        }),
        async (c) => {
            const rewards = await prisma.luckySpinReward.findMany({
                orderBy: { amount: "asc" },
            });

            return c.json(
                {
                    success: true,
                    data: rewards.map((r) => ({
                        ...r,
                        createdAt: r.createdAt.toISOString(),
                        updatedAt: r.updatedAt.toISOString(),
                    })),
                },
                200
            );
        }
    );

    // POST create reward
    app.openapi(
        createRoute({
            method: "post",
            path: "/lucky-spin/rewards",
            tags: ["admin"],
            summary: "Create a new lucky spin reward",
            description: "Create a new reward possibility. The `probability` acts as a relative weight against all other active rewards.",
            request: {
                cookies: authCookie,
                body: {
                    content: {
                        "application/json": {
                            schema: createLuckySpinRewardBodySchema,
                        },
                    },
                },
            },
            responses: {
                201: {
                    description: "Reward created successfully",
                    content: {
                        "application/json": {
                            schema: luckySpinRewardResponseSchema,
                        },
                    },
                },
            },
        }),
        async (c) => {
            const body = c.req.valid("json");

            const reward = await prisma.luckySpinReward.create({
                data: body,
            });

            return c.json(
                {
                    success: true,
                    message: "Reward created successfully",
                    data: {
                        ...reward,
                        createdAt: reward.createdAt.toISOString(),
                        updatedAt: reward.updatedAt.toISOString(),
                    },
                },
                201
            );
        }
    );

    // PATCH update reward
    app.openapi(
        createRoute({
            method: "patch",
            path: "/lucky-spin/rewards/{id}",
            tags: ["admin"],
            summary: "Update a lucky spin reward",
            description: "Modify an existing reward (e.g., to adjust its `probability` weight or toggle `isActive`).",
            request: {
                cookies: authCookie,
                params: z.object({ id: z.string().uuid() }),
                body: {
                    content: {
                        "application/json": {
                            schema: updateLuckySpinRewardBodySchema,
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: "Reward updated successfully",
                    content: {
                        "application/json": {
                            schema: luckySpinRewardResponseSchema,
                        },
                    },
                },
                404: {
                    description: "Reward not found",
                },
            },
        }),
        async (c) => {
            const { id } = c.req.valid("param");
            const body = c.req.valid("json");

            const existing = await prisma.luckySpinReward.findUnique({
                where: { id },
            });

            if (!existing) {
                return c.json({ success: false, message: "Reward not found" }, 404 as any);
            }

            const reward = await prisma.luckySpinReward.update({
                where: { id },
                data: body,
            });

            return c.json(
                {
                    success: true,
                    message: "Reward updated successfully",
                    data: {
                        ...reward,
                        createdAt: reward.createdAt.toISOString(),
                        updatedAt: reward.updatedAt.toISOString(),
                    },
                },
                200
            );
        }
    );

    // DELETE reward
    app.openapi(
        createRoute({
            method: "delete",
            path: "/lucky-spin/rewards/{id}",
            tags: ["admin"],
            summary: "Delete a lucky spin reward",
            description: "Permanently delete a lucky spin reward.",
            request: {
                cookies: authCookie,
                params: z.object({ id: z.string().uuid() }),
            },
            responses: {
                200: {
                    description: "Reward deleted successfully",
                    content: {
                        "application/json": {
                            schema: deleteResponseSchema,
                        },
                    },
                },
                404: {
                    description: "Reward not found",
                },
            },
        }),
        async (c) => {
            const { id } = c.req.valid("param");

            const existing = await prisma.luckySpinReward.findUnique({
                where: { id },
            });

            if (!existing) {
                return c.json({ success: false, message: "Reward not found" }, 404 as any);
            }

            await prisma.luckySpinReward.delete({ where: { id } });

            return c.json(
                { success: true, message: "Reward deleted successfully" },
                200
            );
        }
    );
};
