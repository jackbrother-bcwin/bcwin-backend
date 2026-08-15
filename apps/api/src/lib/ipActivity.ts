import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";

const logger = new Logger("ip-activity");

export enum IpActivityType {
    LOGIN = "LOGIN",
    REGISTER = "REGISTER",
    BETTING = "BETTING",
    DEPOSIT = "DEPOSIT",
    WITHDRAWAL = "WITHDRAWAL",
}

interface LogIpActivityParams {
    ip: string;
    userId?: string;
    activityType: IpActivityType;
    metadata?: Record<string, any>;
}

/**
 * Log IP activity and update IP record
 * This function is used to track user activities from different IPs
 */
export async function logIpActivity({
    ip,
    userId,
    activityType,
    metadata,
}: LogIpActivityParams): Promise<void> {
    try {
        // Log the activity
        await prisma.ipActivity.create({
            data: {
                ip,
                userId: userId || null,
                activityType,
                metadata: metadata
                    ? JSON.parse(JSON.stringify(metadata))
                    : null,
            },
        });

        // Ensure IP record exists and update lastActivityAt
        await prisma.ip.upsert({
            where: { ip },
            create: {
                ip,
                lastActivityAt: new Date(),
                riskLevel: "LOW",
                isBlacklisted: false,
            },
            update: {
                lastActivityAt: new Date(),
            },
        });

        logger.debug(`IP activity logged: ${activityType} from ${ip}`);
    } catch (error) {
        // Log error but don't throw - we don't want IP tracking to break main functionality
        logger.error("Failed to log IP activity:", error);
    }
}

/**
 * Get client IP from request headers
 * Checks common proxy headers first, falls back to socket address
 */
export function getClientIp(headers: Headers): string {
    // Check common proxy headers
    const forwardedFor = headers.get("x-forwarded-for");
    if (forwardedFor) {
        // x-forwarded-for can contain multiple IPs, take the first one
        return forwardedFor.split(",")[0].trim();
    }

    const realIp = headers.get("x-real-ip");
    if (realIp) {
        return realIp.trim();
    }

    const cfConnectingIp = headers.get("cf-connecting-ip"); // Cloudflare
    if (cfConnectingIp) {
        return cfConnectingIp.trim();
    }

    // Fallback - this might not be accurate in production
    return "unknown";
}
