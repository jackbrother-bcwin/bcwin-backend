import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";

const logger = new Logger("ip-risk-calculator");

/**
 * Calculate and update risk levels for all IPs
 * This runs periodically to assess IP risk based on:
 * - Number of users from the same IP
 * - Number of banned users from that IP
 * - Activity patterns
 */
export class IpRiskLevelService {
    /**
     * Update risk levels for all IPs in the system
     */
    static async updateAllIpRiskLevels(): Promise<void> {
        try {
            logger.info("Starting IP risk level calculation...");

            // Get all IPs
            const ips = await prisma.ip.findMany({
                select: {
                    ip: true,
                },
            });

            let lowRiskCount = 0;
            let mediumRiskCount = 0;
            let highRiskCount = 0;

            // Process each IP
            for (const ipRecord of ips) {
                const riskLevel = await this.calculateIpRiskLevel(ipRecord.ip);

                // Update the IP record
                await prisma.ip.update({
                    where: { ip: ipRecord.ip },
                    data: { riskLevel },
                });

                // Count risk levels
                if (riskLevel === "LOW") lowRiskCount++;
                else if (riskLevel === "MEDIUM") mediumRiskCount++;
                else if (riskLevel === "HIGH") highRiskCount++;
            }

            logger.info(
                `IP risk level calculation completed. Low: ${lowRiskCount}, Medium: ${mediumRiskCount}, High: ${highRiskCount}`
            );
        } catch (error) {
            logger.error("Error updating IP risk levels:", error);
            throw error;
        }
    }

    /**
     * Calculate risk level for a single IP
     */
    static async calculateIpRiskLevel(
        ip: string
    ): Promise<"LOW" | "MEDIUM" | "HIGH"> {
        try {
            // Count users from this IP
            const userCount = await prisma.user.count({
                where: { ip },
            });

            // Count banned users from this IP
            const bannedUserCount = await prisma.user.count({
                where: {
                    ip,
                    isBanned: true,
                },
            });

            // Count illegal bets from this IP (last 30 days)
            const thirtyDaysAgo = new Date(
                Date.now() - 30 * 24 * 60 * 60 * 1000
            );
            const illegalBetCount = await prisma.illegalBet.count({
                where: {
                    user: {
                        ip,
                    },
                    createdAt: {
                        gte: thirtyDaysAgo,
                    },
                },
            });

            // Calculate risk score
            let riskScore = 0;

            // User count factor
            if (userCount >= 10) riskScore += 3;
            else if (userCount >= 6) riskScore += 2;
            else if (userCount >= 3) riskScore += 1;

            // Banned users factor
            if (bannedUserCount >= 3) riskScore += 3;
            else if (bannedUserCount >= 2) riskScore += 2;
            else if (bannedUserCount >= 1) riskScore += 1;

            // Illegal bets factor
            if (illegalBetCount >= 10) riskScore += 3;
            else if (illegalBetCount >= 5) riskScore += 2;
            else if (illegalBetCount >= 1) riskScore += 1;

            // Determine risk level based on score
            if (riskScore >= 6) {
                return "HIGH";
            } else if (riskScore >= 3) {
                return "MEDIUM";
            } else {
                return "LOW";
            }
        } catch (error) {
            logger.error(`Error calculating risk for IP ${ip}:`, error);
            return "LOW"; // Default to LOW on error
        }
    }
}
