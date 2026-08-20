/**
 * Sync Lucky Spin recharge tiers (kind LUCKY) from seed defaults.
 * Does not wipe users, rewards, or Invite Wheel rules.
 *
 *   cd backend && bun --env-file .env scripts/update-lucky-spin-rules.ts
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../packages/db/generated/prisma/client";
import { seedLuckySpin } from "../packages/db/seeds/luckySpin";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

await seedLuckySpin(prisma);
const rows = await prisma.luckySpinRule.findMany({
    where: { kind: "LUCKY", isActive: true },
    orderBy: { minDeposit: "asc" },
});
console.log(
    rows.map((r) => ({ minDeposit: r.minDeposit, spinChances: r.spinChances }))
);
await prisma.$disconnect();
