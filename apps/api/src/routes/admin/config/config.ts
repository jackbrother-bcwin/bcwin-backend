import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import { Config, prisma, WingoAlgorithm } from "@bcwin/db";
import { Cache, CacheKey } from "@bcwin/cache";
import { invalidateMaintenanceCache } from "@/middleware/maintenance";

const logger = new Logger("admin-config");

// Config schema
const ConfigSchema = z.object({
    id: z.string().openapi({
        description: "Config ID",
        example: "uuid-123",
    }),
    upiIds: z.array(z.string()).openapi({
        description: "Array of UPI IDs for manual deposits",
        example: ["upi@bank", "upi2@bank"],
    }),
    cxpayEnabled: z.boolean().openapi({
        description: "Whether CXPAY payment gateway is enabled",
        example: true,
    }),
    xdpayEnabled: z.boolean().openapi({
        description: "Whether XDPAY payment gateway is enabled",
        example: true,
    }),
    oxapayEnabled: z.boolean().openapi({
        description: "Whether OXAPAY payment gateway is enabled",
        example: true,
    }),
    upiEnabled: z.boolean().openapi({
        description: "Whether UPI manual payment is enabled",
        example: true,
    }),
    serviceFeePercent: z
        .number()
        .min(0, "Service fee cannot be negative")
        .max(100, "Service fee cannot exceed 100%")
        .openapi({
            description: "Service fee percentage (0–100, non-negative)",
            example: 2,
        }),
    minDepositAmount: z.number().openapi({
        description: "Minimum deposit amount",
        example: 300,
    }),
    minWithdrawAmount: z.number().openapi({
        description: "Minimum withdrawal amount",
        example: 300,
    }),
    wager: z.number().openapi({
        description: "Wager factor for withdrawal",
        example: 1,
    }),
    rewardWagerFactor: z.number().openapi({
        description: "Wager factor for reward/bonus withdrawal",
        example: 1.0,
    }),
    illegalBetPenaltyFactor: z.number().openapi({
        description: "Default illegal betting penalty factor for withdrawal",
        example: 3,
    }),
    maxWithdrawApplicationsPerDay: z.number().openapi({
        description: "Maximum withdrawal applications allowed per day",
        example: 3,
    }),
    announcement: z.string().nullable().openapi({
        description: "Announcement message",
        example:
            "We are currently experiencing technical issues. Please check back later.",
    }),
    wingoAlgorithm: z.enum(WingoAlgorithm).openapi({
        description:
            "Wingo algorithm. Random means the wingo result is random, Winning means the result will try to maximize inhouse profit by choosing the number with least bets on it, TRX means the result is generated from Tron block hashes (same as trxWingo).",
        example: WingoAlgorithm.RANDOM,
    }),
    maintananceMode: z.boolean().openapi({
        description: "Maintenance mode",
        example: false,
    }),
    maintananceMessage: z.string().optional().nullable().openapi({
        description: "Maintenance message",
        example:
            "We are currently experiencing technical issues. Please check back later.",
    }),
    rebatePercent: z.number().openapi({
        description: "Rebate percentage",
        example: 0.5,
    }),
    inrToUsdtPaymentConversionRate: z.number().openapi({
        description: "INR to USDT conversion rate",
        example: 90.0,
    }),
    inrToUsdtWithdrawalConversionRate: z.number().openapi({
        description: "INR to USDT withdrawal conversion rate",
        example: 90.0,
    }),
    inrDepositBonusPercent: z.number().openapi({
        description: "% of INR deposit principal as INR_RECHARGE_BONUS (0 = off)",
        example: 0,
    }),
    usdtDepositBonusPercent: z.number().openapi({
        description: "% of USDT principal as USDT_RECHARGE_BONUS",
        example: 5,
    }),
    createdAt: z.string().openapi({
        description: "Creation timestamp",
        example: "2025-01-12T10:30:00Z",
    }),
    updatedAt: z.string().openapi({
        description: "Last update timestamp",
        example: "2025-01-12T10:30:00Z",
    }),
});

const GetConfigResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the request was successful",
        example: true,
    }),
    config: ConfigSchema,
});

// Update config body schema
const UpdateConfigBodySchema = z.object({
    upiIds: z
        .array(z.string())
        .optional()
        .openapi({
            description: "Array of UPI IDs for manual deposits",
            example: ["upi@bank", "upi2@bank"],
        }),
    cxpayEnabled: z.boolean().optional().openapi({
        description: "Whether CXPAY payment gateway is enabled",
        example: true,
    }),
    xdpayEnabled: z.boolean().optional().openapi({
        description: "Whether XDPAY payment gateway is enabled",
        example: true,
    }),
    oxapayEnabled: z.boolean().optional().openapi({
        description: "Whether OXAPAY payment gateway is enabled",
        example: true,
    }),
    upiEnabled: z.boolean().optional().openapi({
        description: "Whether UPI manual payment is enabled",
        example: true,
    }),
    serviceFeePercent: z
        .number()
        .min(0, "Service fee cannot be negative")
        .max(100, "Service fee cannot exceed 100%")
        .optional()
        .openapi({
            description: "Service fee percentage (0–100, non-negative)",
            example: 2,
        }),
    minDepositAmount: z.number().int().positive().optional().openapi({
        description: "Minimum deposit amount",
        example: 300,
    }),
    minWithdrawAmount: z.number().int().positive().optional().openapi({
        description: "Minimum withdrawal amount",
        example: 300,
    }),
    wager: z.number().nonnegative().optional().openapi({
        description: "Wager factor for withdrawal",
        example: 1,
    }),
    rewardWagerFactor: z.number().nonnegative().optional().openapi({
        description: "Wager factor for reward/bonus withdrawal",
        example: 1.0,
    }),
    illegalBetPenaltyFactor: z.number().positive().optional().openapi({
        description: "Default illegal betting penalty factor for withdrawal",
        example: 3,
    }),
    announcement: z.string().optional().nullable().openapi({
        description: "Announcement message",
        example:
            "We are currently experiencing technical issues. Please check back later.",
    }),
    wingoAlgorithm: z.enum(WingoAlgorithm).optional().openapi({
        description:
            "Wingo algorithm. Random means the wingo result is random, Winning means the result will try to maximize inhouse profit by choosing the number with least bets on it, TRX means the result is generated from Tron block hashes (same as trxWingo).",
        example: WingoAlgorithm.RANDOM,
    }),
    maintananceMode: z.boolean().optional().openapi({
        description: "Maintenance mode",
        example: false,
    }),
    maintananceMessage: z.string().optional().nullable().openapi({
        description: "Maintenance message",
        example:
            "We are currently experiencing technical issues. Please check back later.",
    }),
    rebatePercent: z.number().optional().openapi({
        description: "Rebate percentage",
        example: 0.5,
    }),
    inrToUsdtPaymentConversionRate: z.number().positive().optional().openapi({
        description: "INR to USDT conversion rate",
        example: 90.0,
    }),
    inrToUsdtWithdrawalConversionRate: z.number().positive().optional().openapi({
        description: "INR to USDT withdrawal conversion rate",
        example: 90.0,
    }),
    inrDepositBonusPercent: z.number().min(0).max(100).optional().openapi({
        description: "% of INR deposit principal as INR_RECHARGE_BONUS",
        example: 0,
    }),
    usdtDepositBonusPercent: z.number().min(0).max(100).optional().openapi({
        description: "% of USDT principal as USDT_RECHARGE_BONUS",
        example: 5,
    }),
    maxWithdrawApplicationsPerDay: z
        .number()
        .int()
        .positive()
        .optional()
        .openapi({
            description: "Maximum withdrawal applications allowed per day",
            example: 3,
        }),
});

const UpdateConfigResponseSchema = z.object({
    success: z.boolean().openapi({
        description: "Whether the action was successful",
        example: true,
    }),
    message: z.string().openapi({
        description: "Result message",
        example: "Config updated successfully",
    }),
    config: ConfigSchema,
});

const getConfigRoute = createRoute({
    method: "get",
    path: "/",
    tags: ["admin"],
    summary: "Get configuration",
    description: "Get the current system configuration",
    request: {
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: GetConfigResponseSchema,
                },
            },
            description: "Configuration retrieved successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

const updateConfigRoute = createRoute({
    method: "patch",
    path: "/",
    tags: ["admin"],
    summary: "Update configuration",
    description: "Update the system configuration",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: UpdateConfigBodySchema,
                },
            },
        },
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: UpdateConfigResponseSchema,
                },
            },
            description: "Configuration updated successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.internalServerError(),
    },
});

export const systemConfigRoutes = (app: OpenAPIHono) => {
    app.openapi(getConfigRoute, async (c) => {
        try {
            // Check cache
            const cachedConfig = await Cache.get<Config>(CacheKey.systemConfig);

            if (cachedConfig) {
                return c.json(
                    {
                        success: true,
                        config: cachedConfig,
                    },
                    HTTP_STATUS.OK
                );
            }

            // Get or create config
            let config = await prisma.config.findFirst();

            if (!config) {
                // Create default config if none exists
                config = await prisma.config.create({
                    data: {
                        upiIds: [],
                        cxpayEnabled: false,
                        xdpayEnabled: false,
                        oxapayEnabled: false,
                        upiEnabled: false,
                        serviceFeePercent: 2,
                        minDepositAmount: 300,
                        minWithdrawAmount: 300,
                        wager: 1,
                        illegalBetPenaltyFactor: 3.0,
                        maxWithdrawApplicationsPerDay: 3,
                        announcement: null,
                        wingoAlgorithm: WingoAlgorithm.RANDOM,
                        maintananceMode: false,
                        maintananceMessage: null,
                        rebatePercent: 0.5,
                        inrToUsdtPaymentConversionRate: 90.0,
                        inrToUsdtWithdrawalConversionRate: 90.0,
                        inrDepositBonusPercent: 0,
                        usdtDepositBonusPercent: 5,
                    },
                });
            }

            const result = {
                id: config.id,
                upiIds: config.upiIds,
                cxpayEnabled: config.cxpayEnabled,
                xdpayEnabled: config.xdpayEnabled,
                oxapayEnabled: config.oxapayEnabled,
                upiEnabled: config.upiEnabled,
                serviceFeePercent: config.serviceFeePercent,
                minDepositAmount: config.minDepositAmount,
                minWithdrawAmount: config.minWithdrawAmount,
                wager: config.wager,
                rewardWagerFactor: (config as any).rewardWagerFactor ?? 1.0,
                illegalBetPenaltyFactor: config.illegalBetPenaltyFactor ?? 3.0,
                maxWithdrawApplicationsPerDay:
                    config.maxWithdrawApplicationsPerDay,
                announcement: config.announcement,
                wingoAlgorithm: config.wingoAlgorithm,
                maintananceMode: config.maintananceMode,
                maintananceMessage: config.maintananceMessage,
                rebatePercent: config.rebatePercent,
                inrToUsdtPaymentConversionRate: config.inrToUsdtPaymentConversionRate,
                inrToUsdtWithdrawalConversionRate: config.inrToUsdtWithdrawalConversionRate,
                inrDepositBonusPercent:
                    (config as { inrDepositBonusPercent?: number })
                        .inrDepositBonusPercent ?? 0,
                usdtDepositBonusPercent:
                    (config as { usdtDepositBonusPercent?: number })
                        .usdtDepositBonusPercent ?? 5,
                createdAt: config.createdAt.toISOString(),
                updatedAt: config.updatedAt.toISOString(),
            };

            // Cache for 10 days
            await Cache.set(CacheKey.systemConfig, result, 60 * 60 * 24 * 10);

            return c.json(
                {
                    success: true,
                    config: result,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error(error);
            return apiError(
                c,
                "Internal server error",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    app.openapi(updateConfigRoute, async (c) => {
        try {
            const updates = c.req.valid("json");

            // Get or create config
            let config = await prisma.config.findFirst();

            logger.debug("updates", updates);

            if (!config) {
                // Create config with provided values or defaults
                config = await prisma.config.create({
                    data: {
                        upiIds: updates.upiIds ?? [],
                        cxpayEnabled: updates.cxpayEnabled ?? false,
                        xdpayEnabled: updates.xdpayEnabled ?? false,
                        oxapayEnabled: updates.oxapayEnabled ?? false,
                        upiEnabled: updates.upiEnabled ?? false,
                        serviceFeePercent: updates.serviceFeePercent ?? 2,
                        minDepositAmount: updates.minDepositAmount ?? 300,
                        minWithdrawAmount: updates.minWithdrawAmount ?? 300,
                        wager: updates.wager ?? 1,
                        rewardWagerFactor: updates.rewardWagerFactor ?? 1.0,
                        illegalBetPenaltyFactor: updates.illegalBetPenaltyFactor ?? 3.0,
                        maxWithdrawApplicationsPerDay:
                            updates.maxWithdrawApplicationsPerDay ?? 3,
                        announcement: updates.announcement ?? null,
                        wingoAlgorithm:
                            updates.wingoAlgorithm ?? WingoAlgorithm.RANDOM,
                        maintananceMode: updates.maintananceMode ?? false,
                        maintananceMessage: updates.maintananceMessage ?? null,
                        rebatePercent: updates.rebatePercent ?? 0.5,
                        inrToUsdtPaymentConversionRate: updates.inrToUsdtPaymentConversionRate ?? 90.0,
                        inrToUsdtWithdrawalConversionRate: updates.inrToUsdtWithdrawalConversionRate ?? 90.0,
                        inrDepositBonusPercent: updates.inrDepositBonusPercent ?? 0,
                        usdtDepositBonusPercent: updates.usdtDepositBonusPercent ?? 5,
                    },
                });
            } else {
                // Update existing config
                const updateData: any = {};
                if (updates.upiIds !== undefined)
                    updateData.upiIds = updates.upiIds;
                if (updates.cxpayEnabled !== undefined)
                    updateData.cxpayEnabled = updates.cxpayEnabled;
                if (updates.xdpayEnabled !== undefined)
                    updateData.xdpayEnabled = updates.xdpayEnabled;
                if (updates.oxapayEnabled !== undefined)
                    updateData.oxapayEnabled = updates.oxapayEnabled;
                if (updates.upiEnabled !== undefined)
                    updateData.upiEnabled = updates.upiEnabled;
                if (updates.serviceFeePercent !== undefined)
                    updateData.serviceFeePercent = updates.serviceFeePercent;
                if (updates.minDepositAmount !== undefined)
                    updateData.minDepositAmount = updates.minDepositAmount;
                if (updates.minWithdrawAmount !== undefined)
                    updateData.minWithdrawAmount = updates.minWithdrawAmount;
                if (updates.wager !== undefined)
                    updateData.wager = updates.wager;
                if (updates.rewardWagerFactor !== undefined)
                    updateData.rewardWagerFactor = updates.rewardWagerFactor;
                if (updates.illegalBetPenaltyFactor !== undefined)
                    updateData.illegalBetPenaltyFactor = updates.illegalBetPenaltyFactor;
                if (updates.maxWithdrawApplicationsPerDay !== undefined)
                    updateData.maxWithdrawApplicationsPerDay =
                        updates.maxWithdrawApplicationsPerDay;
                if (updates.announcement !== undefined)
                    updateData.announcement = updates.announcement;
                if (updates.wingoAlgorithm !== undefined)
                    updateData.wingoAlgorithm = updates.wingoAlgorithm;
                if (updates.maintananceMode !== undefined)
                    updateData.maintananceMode = updates.maintananceMode;
                if (updates.maintananceMessage !== undefined)
                    updateData.maintananceMessage = updates.maintananceMessage;
                if (updates.rebatePercent !== undefined)
                    updateData.rebatePercent = updates.rebatePercent;
                if (updates.inrToUsdtPaymentConversionRate !== undefined)
                    updateData.inrToUsdtPaymentConversionRate = updates.inrToUsdtPaymentConversionRate;
                if (updates.inrToUsdtWithdrawalConversionRate !== undefined)
                    updateData.inrToUsdtWithdrawalConversionRate = updates.inrToUsdtWithdrawalConversionRate;
                if (updates.inrDepositBonusPercent !== undefined)
                    updateData.inrDepositBonusPercent = updates.inrDepositBonusPercent;
                if (updates.usdtDepositBonusPercent !== undefined)
                    updateData.usdtDepositBonusPercent = updates.usdtDepositBonusPercent;

                config = await prisma.config.update({
                    where: { id: config.id },
                    data: updateData,
                });
            }

            const result = {
                id: config.id,
                upiIds: config.upiIds,
                cxpayEnabled: config.cxpayEnabled,
                xdpayEnabled: config.xdpayEnabled,
                oxapayEnabled: config.oxapayEnabled,
                upiEnabled: config.upiEnabled,
                serviceFeePercent: config.serviceFeePercent,
                minDepositAmount: config.minDepositAmount,
                minWithdrawAmount: config.minWithdrawAmount,
                wager: config.wager,
                rewardWagerFactor: (config as any).rewardWagerFactor ?? 1.0,
                illegalBetPenaltyFactor: config.illegalBetPenaltyFactor ?? 3.0,
                maxWithdrawApplicationsPerDay:
                    config.maxWithdrawApplicationsPerDay,
                announcement: config.announcement,
                wingoAlgorithm: config.wingoAlgorithm,
                maintananceMode: config.maintananceMode,
                maintananceMessage: config.maintananceMessage,
                rebatePercent: config.rebatePercent,
                inrToUsdtPaymentConversionRate: config.inrToUsdtPaymentConversionRate,
                inrToUsdtWithdrawalConversionRate: config.inrToUsdtWithdrawalConversionRate,
                inrDepositBonusPercent:
                    (config as { inrDepositBonusPercent?: number })
                        .inrDepositBonusPercent ?? 0,
                usdtDepositBonusPercent:
                    (config as { usdtDepositBonusPercent?: number })
                        .usdtDepositBonusPercent ?? 5,
                createdAt: config.createdAt.toISOString(),
                updatedAt: config.updatedAt.toISOString(),
            };

            // Update cache with new config (10 days TTL)
            await Cache.set(CacheKey.systemConfig, result, 60 * 60 * 24 * 10);

            // Immediately bust maintenance cache if the toggle changed
            if (updates.maintananceMode !== undefined || updates.maintananceMessage !== undefined) {
                await invalidateMaintenanceCache();
                logger.info(`Maintenance cache invalidated (mode=${result.maintananceMode})`);
            }

            logger.info("System config updated", updates);

            return c.json(
                {
                    success: true,
                    message: "Config updated successfully",
                    config: result,
                },
                HTTP_STATUS.OK
            );
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
