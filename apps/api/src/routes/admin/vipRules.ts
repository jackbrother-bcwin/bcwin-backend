import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import { prisma } from "@bcwin/db";
import { createVipRuleSchema, updateVipRuleSchema } from "../../schemas/admin/vipRules";

const logger = new Logger("admin-vip-rules");

const VipRuleResponseSchema = z.object({
    id: z.string(),
    level: z.number(),
    expRequired: z.number(),
    levelUpReward: z.number(),
    monthlyReward: z.number(),
    rebateRate: z.string().nullable(),
    teamSize: z.number(),
    teamBetting: z.number(),
    teamDeposit: z.number(),
    vipName: z.string().nullable(),
    minBet: z.number().nullable(),
    oneTimeBonus: z.number().nullable(),
    monthlyBonus: z.number().nullable(),
    rebatePercentage: z.number().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

// List
const listVipRulesRoute = createRoute({
    method: "get",
    path: "/",
    tags: ["admin"],
    summary: "List VIP rules",
    description: "Get a list of all VIP rules sorted by level",
    request: {
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        rules: z.array(VipRuleResponseSchema),
                    }),
                },
            },
            description: "VIP rules retrieved successfully",
        },
        ...CommonResponses.internalServerError(),
    },
});

// Create
const createVipRuleRoute = createRoute({
    method: "post",
    path: "/",
    tags: ["admin"],
    summary: "Create a VIP rule",
    description: "Create a new VIP rule level combination",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: createVipRuleSchema,
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        message: z.string(),
                        rule: VipRuleResponseSchema,
                    }),
                },
            },
            description: "VIP rule created successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

// Update
const updateVipRuleRoute = createRoute({
    method: "patch",
    path: "/:id",
    tags: ["admin"],
    summary: "Update a VIP rule",
    description: "Update an existing VIP rule",
    request: {
        params: z.object({
            id: z.string().openapi({ description: "VIP rule ID" }),
        }),
        body: {
            content: {
                "application/json": {
                    schema: updateVipRuleSchema,
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        message: z.string(),
                        rule: VipRuleResponseSchema,
                    }),
                },
            },
            description: "VIP rule updated successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

// Delete
const deleteVipRuleRoute = createRoute({
    method: "delete",
    path: "/:id",
    tags: ["admin"],
    summary: "Delete a VIP rule",
    description: "Delete a VIP rule permanently",
    request: {
        params: z.object({
            id: z.string().openapi({ description: "VIP rule ID" }),
        }),
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.boolean(),
                        message: z.string(),
                    }),
                },
            },
            description: "VIP rule deleted successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

const formatRule = (r: any) => ({
    ...r,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
});

export const vipRulesRoutes = (app: OpenAPIHono) => {
    // List rules
    app.openapi(listVipRulesRoute, async (c) => {
        try {
            const rules = await prisma.vipLevelRequirement.findMany({
                orderBy: { level: "asc" },
            });

            return c.json(
                {
                    success: true,
                    rules: rules.map(formatRule),
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error listing vip rules:", error);
            return apiError(c, "Internal server error", HTTP_STATUS.INTERNAL_SERVER_ERROR);
        }
    });

    // Create rule
    app.openapi(createVipRuleRoute, async (c) => {
        try {
            const data = c.req.valid("json");

            const existing = await prisma.vipLevelRequirement.findUnique({
                where: { level: data.level },
            });

            if (existing) {
                return apiError(c, "A rule for this level already exists", HTTP_STATUS.BAD_REQUEST);
            }

            const rule = await prisma.vipLevelRequirement.create({
                data,
            });

            logger.info("VIP rule created", { level: data.level });

            return c.json(
                {
                    success: true,
                    message: "VIP rule created successfully",
                    rule: formatRule(rule),
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error creating vip rule:", error);
            return apiError(c, "Internal server error", HTTP_STATUS.INTERNAL_SERVER_ERROR);
        }
    });

    // Update rule
    app.openapi(updateVipRuleRoute, async (c) => {
        try {
            const { id } = c.req.valid("param");
            const updates = c.req.valid("json");

            const existing = await prisma.vipLevelRequirement.findUnique({
                where: { id },
            });

            if (!existing) {
                return apiError(c, "VIP rule not found", HTTP_STATUS.BAD_REQUEST);
            }

            if (updates.level !== undefined && updates.level !== existing.level) {
                const levelExists = await prisma.vipLevelRequirement.findUnique({
                    where: { level: updates.level },
                });
                if (levelExists) {
                    return apiError(c, "A rule for this level already exists", HTTP_STATUS.BAD_REQUEST);
                }
            }

            const rule = await prisma.vipLevelRequirement.update({
                where: { id },
                data: updates,
            });

            logger.info("VIP rule updated", { id });

            return c.json(
                {
                    success: true,
                    message: "VIP rule updated successfully",
                    rule: formatRule(rule),
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error updating vip rule:", error);
            return apiError(c, "Internal server error", HTTP_STATUS.INTERNAL_SERVER_ERROR);
        }
    });

    // Delete rule
    app.openapi(deleteVipRuleRoute, async (c) => {
        try {
            const { id } = c.req.valid("param");

            const existing = await prisma.vipLevelRequirement.findUnique({
                where: { id },
            });

            if (!existing) {
                return apiError(c, "VIP rule not found", HTTP_STATUS.BAD_REQUEST);
            }

            await prisma.vipLevelRequirement.delete({ where: { id } });

            logger.info("VIP rule deleted", { id });

            return c.json(
                {
                    success: true,
                    message: "VIP rule deleted successfully",
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error deleting vip rule:", error);
            return apiError(c, "Internal server error", HTTP_STATUS.INTERNAL_SERVER_ERROR);
        }
    });
};
