import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { prisma } from "@bcwin/db";
import { authCookie } from "@/schemas";
import { z } from "zod";
import {
    getTiersQuerySchema,
    getTiersResponseSchema,
    createTierBodySchema,
    createTierResponseSchema,
    updateTierBodySchema,
    deleteTierResponseSchema,
    activityBonusTierSchema,
} from "../../schemas/admin/activityBonusSettings";

export const activityBonusSettingsRoutes = (app: OpenAPIHono) => {
    // GET all tiers
    app.openapi(
        createRoute({
            method: "get",
            path: "/activity-bonuses/tiers",
            tags: ["Admin Activity Tiers"],
            summary: "Get all activity bonus tiers",
            request: {
                query: getTiersQuerySchema,
                cookies: authCookie,
            },
            responses: {
                200: {
                    description: "Activity bonus tiers fetched successfully",
                    content: {
                        "application/json": {
                            schema: getTiersResponseSchema,
                        },
                    },
                },
            },
        }),
        async (c) => {
            const { type } = c.req.valid("query");

            const tiers = await prisma.activityBonusTier.findMany({
                where: type ? { type } : undefined,
                orderBy: [
                    { depositRequirement: "asc" },
                    { betRequirement: "asc" },
                ],
            });

            return c.json(
                {
                    success: true,
                    data: tiers.map(t => ({
                        ...t,
                        createdAt: t.createdAt.toISOString(),
                        updatedAt: t.updatedAt.toISOString(),
                    })),
                },
                200
            );
        }
    );

    // POST create a tier
    app.openapi(
        createRoute({
            method: "post",
            path: "/activity-bonuses/tiers",
            tags: ["Admin Activity Tiers"],
            summary: "Create a new activity bonus tier",
            request: {
                cookies: authCookie,
                body: {
                    content: {
                        "application/json": {
                            schema: createTierBodySchema,
                        },
                    },
                },
            },
            responses: {
                201: {
                    description: "Tier created successfully",
                    content: {
                        "application/json": {
                            schema: createTierResponseSchema,
                        },
                    },
                },
                400: {
                    description: "Bad Request",
                },
            },
        }),
        async (c) => {
            const body = c.req.valid("json");

            const tier = await prisma.activityBonusTier.create({
                data: {
                    type: body.type,
                    depositRequirement: body.depositRequirement,
                    betRequirement: body.betRequirement,
                    inviteRequirement: body.inviteRequirement,
                    dayRequirement: body.dayRequirement,
                    reward: body.reward,
                },
            });

            return c.json(
                {
                    success: true,
                    message: "Tier created successfully",
                    data: {
                        ...tier,
                        createdAt: tier.createdAt.toISOString(),
                        updatedAt: tier.updatedAt.toISOString(),
                    },
                },
                201
            );
        }
    );

    // PUT update a tier
    app.openapi(
        createRoute({
            method: "put",
            path: "/activity-bonuses/tiers/{id}",
            tags: ["Admin Activity Tiers"],
            summary: "Update an activity bonus tier",
            request: {
                cookies: authCookie,
                params: z.object({
                    id: z.string().uuid(),
                }),
                body: {
                    content: {
                        "application/json": {
                            schema: updateTierBodySchema,
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: "Tier updated successfully",
                    content: {
                        "application/json": {
                            schema: createTierResponseSchema,
                        },
                    },
                },
                404: {
                    description: "Tier not found",
                },
            },
        }),
        async (c) => {
            const { id } = c.req.valid("param");
            const body = c.req.valid("json");

            const existingTier = await prisma.activityBonusTier.findUnique({
                where: { id },
            });

            if (!existingTier) {
                return c.json(
                    { success: false, message: "Tier not found" },
                    404 as any
                );
            }

            const tier = await prisma.activityBonusTier.update({
                where: { id },
                data: {
                    depositRequirement: body.depositRequirement,
                    betRequirement: body.betRequirement,
                    inviteRequirement: body.inviteRequirement,
                    dayRequirement: body.dayRequirement,
                    reward: body.reward,
                },
            });

            return c.json(
                {
                    success: true,
                    message: "Tier updated successfully",
                    data: {
                        ...tier,
                        createdAt: tier.createdAt.toISOString(),
                        updatedAt: tier.updatedAt.toISOString(),
                    },
                },
                200
            );
        }
    );

    // DELETE a tier
    app.openapi(
        createRoute({
            method: "delete",
            path: "/activity-bonuses/tiers/{id}",
            tags: ["Admin Activity Tiers"],
            summary: "Delete an activity bonus tier",
            request: {
                cookies: authCookie,
                params: z.object({
                    id: z.string().uuid(),
                }),
            },
            responses: {
                200: {
                    description: "Tier deleted successfully",
                    content: {
                        "application/json": {
                            schema: deleteTierResponseSchema,
                        },
                    },
                },
                404: {
                    description: "Tier not found",
                },
            },
        }),
        async (c) => {
            const { id } = c.req.valid("param");

            const existingTier = await prisma.activityBonusTier.findUnique({
                where: { id },
            });

            if (!existingTier) {
                return c.json(
                    { success: false, message: "Tier not found" },
                    404 as any
                );
            }

            await prisma.activityBonusTier.delete({
                where: { id },
            });

            return c.json(
                {
                    success: true,
                    message: "Tier deleted successfully",
                },
                200
            );
        }
    );
};
