import { prisma } from "@bcwin/db";
import { getIstDayRange } from "./apps/api/src/lib/autoSalaryService.ts";

try {
  const page = 1, limit = 100, periodDate = "2026-07-19";
  const skip = (page - 1) * limit;
  const where: any = {};
  const { periodDate: pd } = getIstDayRange(periodDate);
  console.log("pd", pd.toISOString());
  where.periodDate = pd;

  const [claims, total] = await Promise.all([
    prisma.autoSalaryClaim.findMany({
      where,
      take: limit,
      skip,
      orderBy: [{ periodDate: "desc" }, { amount: "desc" }],
      include: {
        user: {
          select: {
            serialNumber: true,
            username: true,
            mobileNumber: true,
          },
        },
      },
    }),
    prisma.autoSalaryClaim.count({ where }),
  ]);
  console.log("ok", claims.length, total);
} catch (e) {
  console.error("FAIL", e);
}
await prisma.$disconnect();
