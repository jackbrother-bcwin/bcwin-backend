-- CreateEnum
CREATE TYPE "VipRewardType" AS ENUM ('LEVEL_UP', 'MONTHLY');

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "xp" SET DEFAULT 0,
ALTER COLUMN "xp" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "VipLevelRequirement" ADD COLUMN     "expRequired" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "levelUpReward" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "monthlyReward" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "rebateRate" TEXT,
ALTER COLUMN "teamSize" SET DEFAULT 0,
ALTER COLUMN "teamBetting" SET DEFAULT 0,
ALTER COLUMN "teamDeposit" SET DEFAULT 0;

-- CreateTable
CREATE TABLE "VipRewardClaim" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "type" "VipRewardType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "monthYear" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VipRewardClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VipRewardClaim_userId_idx" ON "VipRewardClaim"("userId");

-- CreateIndex
CREATE INDEX "VipRewardClaim_userId_type_idx" ON "VipRewardClaim"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "VipRewardClaim_userId_level_type_monthYear_key" ON "VipRewardClaim"("userId", "level", "type", "monthYear");

-- AddForeignKey
ALTER TABLE "VipRewardClaim" ADD CONSTRAINT "VipRewardClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
