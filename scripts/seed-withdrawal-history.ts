/**
 * Standalone seed script for withdrawal history across all statuses.
 *
 * Usage:
 *   cd backend && bun --env-file .env scripts/seed-withdrawal-history.ts
 *
 * Target a specific user:
 *   TARGET_USER=9855641885 bun --env-file .env scripts/seed-withdrawal-history.ts
 *   TARGET_USER=1111111111 bun --env-file .env scripts/seed-withdrawal-history.ts
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../packages/db/generated/prisma/client";
import { seedWithdrawals } from "../packages/db/seeds/withdrawals";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
    console.log("🚀 Running withdrawal history seed script...\n");
    await seedWithdrawals(prisma, process.env.TARGET_USER);
    console.log("\n🎉 Done!");
}

main()
    .catch((e) => {
        console.error("❌ Seeding failed:", e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
