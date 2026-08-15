import { z } from "@hono/zod-openapi";
import { activityBonusTypeSchema } from "../activity";

export const activityBonusTierSchema = z.object({
    id: z.string().uuid(),
    type: activityBonusTypeSchema,
    depositRequirement: z.number().nullable(),
    betRequirement: z.number().nullable(),
    inviteRequirement: z.number().nullable(),
    dayRequirement: z.number().nullable(),
    reward: z.number(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
});

export const getTiersQuerySchema = z.object({
    type: activityBonusTypeSchema.optional(),
});

export const getTiersResponseSchema = z.object({
    success: z.boolean(),
    data: z.array(activityBonusTierSchema),
});

export const createTierBodySchema = z.object({
    type: activityBonusTypeSchema,
    depositRequirement: z.number().optional().nullable(),
    betRequirement: z.number().optional().nullable(),
    inviteRequirement: z.number().optional().nullable(),
    dayRequirement: z.number().optional().nullable(),
    reward: z.number().min(0),
});

export const createTierResponseSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    data: activityBonusTierSchema,
});

export const updateTierBodySchema = z.object({
    depositRequirement: z.number().optional().nullable(),
    betRequirement: z.number().optional().nullable(),
    inviteRequirement: z.number().optional().nullable(),
    dayRequirement: z.number().optional().nullable(),
    reward: z.number().min(0).optional(),
});

export const deleteTierResponseSchema = z.object({
    success: z.boolean(),
    message: z.string(),
});
