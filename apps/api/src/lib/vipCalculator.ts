// import { prisma } from "@bcwin/db";
// import Logger from "@bcwin/logger";
// import { TeamMetricsCalculator } from "./teamMetricsCalculator";

// const logger = new Logger("vip-calculator");

// interface TeamMetricsData {
//     teamSize: number;
//     teamBetting: number;
//     teamDeposit: number;
// }

// export class VipCalculator {
//     /**
//      * Calculate VIP level for a specific user based on team metrics
//      */
//     static async calculateUserVipLevel(userId: string): Promise<number> {
//         try {
//             // Get or calculate team metrics
//             const teamMetrics = await this.getTeamMetrics(userId);

//             // Get VIP requirements (ordered from highest to lowest)
//             const vipRequirements = await prisma.vipLevelRequirement.findMany({
//                 orderBy: { level: "desc" },
//             });

//             // Find highest VIP level user qualifies for
//             for (const requirement of vipRequirements) {
//                 if (
//                     teamMetrics.teamSize >= requirement.teamSize &&
//                     teamMetrics.teamBetting >= requirement.teamBetting &&
//                     teamMetrics.teamDeposit >= requirement.teamDeposit
//                 ) {
//                     logger.debug(
//                         `User ${userId} qualifies for VIP level ${requirement.level}`
//                     );
//                     return requirement.level;
//                 }
//             }

//             // Default to level 0 if no requirements met
//             return 0;
//         } catch (error) {
//             logger.error(`Error calculating VIP level for user ${userId}:`, error);
//             return 0; // Default to level 0 on error
//         }
//     }

//     /**
//      * Update VIP level for a specific user
//      */
//     static async updateUserVipLevel(userId: string): Promise<void> {
//         try {
//             const newVipLevel = await this.calculateUserVipLevel(userId);

//             // Get current VIP level
//             const currentVipLevel = await prisma.userVipLevel.findUnique({
//                 where: { userId },
//                 select: { currentLevel: true },
//             });

//             const oldLevel = currentVipLevel?.currentLevel || 0;

//             // Update or create UserVipLevel
//             await prisma.userVipLevel.upsert({
//                 where: { userId },
//                 update: {
//                     currentLevel: newVipLevel,
//                     lastCalculatedAt: new Date(),
//                 },
//                 create: {
//                     userId,
//                     currentLevel: newVipLevel,
//                     teamSize: 0,
//                     teamBetting: 0,
//                     teamDeposit: 0,
//                     lastCalculatedAt: new Date(),
//                 },
//             });

//             // Log level changes
//             if (newVipLevel !== oldLevel) {
//                 logger.info(
//                     `User ${userId} VIP level changed: ${oldLevel} -> ${newVipLevel}`
//                 );
//             } else {
//                 logger.debug(`User ${userId} VIP level unchanged: ${newVipLevel}`);
//             }
//         } catch (error) {
//             logger.error(`Error updating VIP level for user ${userId}:`, error);
//             throw error;
//         }
//     }

//     /**
//      * Update VIP levels for all users (scheduled daily)
//      */
//     static async updateAllUserVipLevels(): Promise<void> {
//         logger.info("Starting VIP level calculation for all users...");

//         const batchSize = 100;
//         let skip = 0;
//         let totalUsers = 0;
//         let updatedUsers = 0;

//         try {
//             while (true) {
//                 // Get batch of users
//                 const users = await prisma.user.findMany({
//                     skip,
//                     take: batchSize,
//                     where: { isBanned: false },
//                     select: { id: true },
//                 });

//                 if (users.length === 0) break;

//                 totalUsers += users.length;

//                 // Process each user in the batch
//                 for (const user of users) {
//                     try {
//                         // First, update team metrics
//                         await TeamMetricsCalculator.calculateAndUpdateTeamMetrics(
//                             user.id
//                         );

//                         // Then, update VIP level based on new metrics
//                         await this.updateUserVipLevel(user.id);

//                         updatedUsers++;
//                     } catch (error) {
//                         logger.error(
//                             `Failed to update VIP level for user ${user.id}:`,
//                             error
//                         );
//                         // Continue with other users
//                     }
//                 }

//                 skip += batchSize;

//                 logger.info(
//                     `Processed ${totalUsers} users, updated ${updatedUsers} successfully`
//                 );
//             }

//             logger.info(
//                 `VIP level calculation completed. Total: ${totalUsers}, Updated: ${updatedUsers}`
//             );
//         } catch (error) {
//             logger.error("Error in updateAllUserVipLevels:", error);
//             throw error;
//         }
//     }

//     /**
//      * Get team metrics for a user (from cache or calculate)
//      */
//     private static async getTeamMetrics(userId: string): Promise<TeamMetricsData> {
//         // Try to get from TeamMetrics cache
//         let teamMetrics = await prisma.teamMetrics.findUnique({
//             where: { userId },
//             select: {
//                 totalTeamSize: true,
//                 totalTeamBetting: true,
//                 totalTeamDeposit: true,
//                 lastUpdated: true,
//             },
//         });

//         // If not in cache or stale (older than 1 hour), recalculate
//         const ONE_HOUR = 3600000;
//         if (
//             !teamMetrics ||
//             Date.now() - teamMetrics.lastUpdated.getTime() > ONE_HOUR
//         ) {
//             logger.debug(`Team metrics stale or missing for user ${userId}, recalculating`);

//             // Calculate and update metrics
//             await TeamMetricsCalculator.calculateAndUpdateTeamMetrics(userId);

//             // Fetch updated metrics
//             teamMetrics = await prisma.teamMetrics.findUnique({
//                 where: { userId },
//                 select: {
//                     totalTeamSize: true,
//                     totalTeamBetting: true,
//                     totalTeamDeposit: true,
//                     lastUpdated: true,
//                 },
//             });
//         }

//         return {
//             teamSize: teamMetrics?.totalTeamSize || 0,
//             teamBetting: teamMetrics?.totalTeamBetting || 0,
//             teamDeposit: teamMetrics?.totalTeamDeposit || 0,
//         };
//     }

//     /**
//      * Update VIP level for users in a specific batch
//      * Useful for parallel processing
//      */
//     static async updateVipLevelsForBatch(userIds: string[]): Promise<void> {
//         logger.info(`Updating VIP levels for batch of ${userIds.length} users`);

//         for (const userId of userIds) {
//             try {
//                 await TeamMetricsCalculator.calculateAndUpdateTeamMetrics(userId);
//                 await this.updateUserVipLevel(userId);
//             } catch (error) {
//                 logger.error(`Failed to update VIP for user ${userId}:`, error);
//                 // Continue with other users
//             }
//         }

//         logger.info(`Completed VIP level update for batch`);
//     }

//     /**
//      * Check if a user meets requirements for a specific VIP level
//      */
//     static async checkVipRequirements(
//         userId: string,
//         targetLevel: number
//     ): Promise<boolean> {
//         const teamMetrics = await this.getTeamMetrics(userId);

//         const requirement = await prisma.vipLevelRequirement.findUnique({
//             where: { level: targetLevel },
//         });

//         if (!requirement) {
//             logger.warn(`VIP requirement not found for level ${targetLevel}`);
//             return false;
//         }

//         return (
//             teamMetrics.teamSize >= requirement.teamSize &&
//             teamMetrics.teamBetting >= requirement.teamBetting &&
//             teamMetrics.teamDeposit >= requirement.teamDeposit
//         );
//     }
// }
