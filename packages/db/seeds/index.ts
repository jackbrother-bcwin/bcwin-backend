import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client";
import { seedCommissionRates } from "./commissionRates";
import { seedVipRequirements } from "./vipRequirements";
import { seedRebateRates } from "./rebateRates";
import { seedLuckySpin } from "./luckySpin";
import { seedSelfRebateRates } from "./selfRebateRates";
import { seedWithdrawals } from "./withdrawals";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
    console.log("🚀 Starting database seeding...\n");

    try {
        // Seed VIP requirements first
        await seedVipRequirements();

        // Then seed commission rates (independent of rebate)
        await seedCommissionRates();

        // Multi-level category rebate rates (1.md)
        await seedRebateRates(prisma);

        // Lucky spin wheel prizes + deposit→extra-spin rules
        await seedLuckySpin(prisma);

        await seedSelfRebateRates(prisma);

        // Withdrawal history across all statuses
        await seedWithdrawals(prisma);

        console.log("🎉 All seeds completed successfully!");
    } catch (error) {
        console.error("❌ Error during seeding:", error);
        throw error;
    }
}

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
