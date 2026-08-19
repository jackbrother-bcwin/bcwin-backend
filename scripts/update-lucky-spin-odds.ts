import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../packages/db/generated/prisma/client";
import { seedLuckySpin } from "../packages/db/seeds/luckySpin";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

await seedLuckySpin(prisma);
const rows = await prisma.luckySpinReward.findMany({
    where: { kind: "LUCKY" },
    orderBy: { amount: "asc" },
});
console.log(
    rows.map((r) => ({ amount: r.amount, probability: r.probability }))
);
await prisma.$disconnect();
