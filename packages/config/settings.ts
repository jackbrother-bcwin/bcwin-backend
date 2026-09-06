import { prisma, type Config as DBConfig, WingoAlgorithm } from "@bcwin/db";
import { SystemConfigCache } from "@bcwin/cache";

// Re-export or use the DB type
export type SystemConfigData = DBConfig;

export class SystemSettings {
    /**
     * Fetches the system configuration from Cache or DB.
     * @returns The system configuration object or null if not found.
     */
    static async get(): Promise<SystemConfigData | null> {
        try {
            return await SystemConfigCache.getOrLoad(() => prisma.config.findFirst());
        } catch (error) {
            console.error("Error fetching config:", error);
            return null;
        }
    }

    /** Called after a config commit; errors must reach the admin API. */
    static async refresh(): Promise<SystemConfigData | null> {
        await SystemConfigCache.invalidate();
        // Re-read the DB instead of caching an earlier update's returned row:
        // another admin may already have committed a newer change.
        return SystemConfigCache.getOrLoad(() => prisma.config.findFirst(), true);
    }

    static async getServiceFeePercent(): Promise<number> {
        const config = await this.get();
        return config?.serviceFeePercent ?? 0; // Default safe value? Or throw? Original used !
    }

    static async getMinDepositAmount(): Promise<number> {
        const config = await this.get();
        return config?.minDepositAmount ?? 0;
    }

    static async getMinWithdrawAmount(): Promise<number> {
        const config = await this.get();
        return config?.minWithdrawAmount ?? 0;
    }

    static async getCxpayEnabled(): Promise<boolean> {
        const config = await this.get();
        return config?.cxpayEnabled ?? false;
    }

    static async getXdpayEnabled(): Promise<boolean> {
        const config = await this.get();
        return config?.xdpayEnabled ?? false;
    }

    static async getOxapayEnabled(): Promise<boolean> {
        const config = await this.get();
        return config?.oxapayEnabled ?? false;
    }

    static async getUpiEnabled(): Promise<boolean> {
        const config = await this.get();
        return config?.upiEnabled ?? false;
    }

    static async getWingoAlgorithm(): Promise<WingoAlgorithm> {
        const config = await this.get();
        return config?.wingoAlgorithm ?? WingoAlgorithm.RANDOM;
    }

    static async getMaintananceMode(): Promise<boolean> {
        const config = await this.get();
        return config?.maintananceMode ?? false;
    }

    static async getMaintananceMessage(): Promise<string | null> {
        const config = await this.get();
        return config?.maintananceMessage ?? null;
    }

    static async getWagerFactor(): Promise<number> {
        const config = await this.get();
        return config?.wager ?? 1;
    }

    static async getRewardWagerFactor(): Promise<number> {
        const config = await this.get();
        return (config as any)?.rewardWagerFactor ?? 1.0;
    }

    static async getMaxWithdrawApplicationsPerDay(): Promise<number> {
        const config = await this.get();
        return config?.maxWithdrawApplicationsPerDay ?? 3;
    }

    static async getRebatePercent(): Promise<number> {
        const config = await this.get();
        return config?.rebatePercent ?? 0.5;
    }

    static async getInrToUsdtPaymentConversionRate(): Promise<number> {
        const config = await this.get();
        return config?.inrToUsdtPaymentConversionRate ?? 105.0;
    }

    static async getInrToUsdtWithdrawalConversionRate(): Promise<number> {
        const config = await this.get();
        return config?.inrToUsdtWithdrawalConversionRate ?? 100.0;
    }

    /** % of INR deposit principal as INR_RECHARGE_BONUS (default 0 = off) */
    static async getInrDepositBonusPercent(): Promise<number> {
        const config = await this.get();
        return (config as { inrDepositBonusPercent?: number } | null)
            ?.inrDepositBonusPercent ?? 0;
    }

    /** % of USDT principal as USDT_RECHARGE_BONUS (default 5) */
    static async getUsdtDepositBonusPercent(): Promise<number> {
        const config = await this.get();
        return (config as { usdtDepositBonusPercent?: number } | null)
            ?.usdtDepositBonusPercent ?? 5;
    }
}
