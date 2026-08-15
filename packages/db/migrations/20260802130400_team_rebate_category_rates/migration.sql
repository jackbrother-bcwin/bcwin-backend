-- CreateEnum
CREATE TYPE "RebateGameCategory" AS ENUM ('LOTTERY', 'CASINO', 'SPORTS', 'RUMMY');

-- AlterTable Rebate: team multi-level fields
ALTER TABLE "Rebate" ADD COLUMN IF NOT EXISTS "fromUserId" TEXT;
ALTER TABLE "Rebate" ADD COLUMN IF NOT EXISTS "gameCategory" "RebateGameCategory";
ALTER TABLE "Rebate" ADD COLUMN IF NOT EXISTS "layer" INTEGER;
ALTER TABLE "Rebate" ADD COLUMN IF NOT EXISTS "receiverVip" INTEGER;
ALTER TABLE "Rebate" ADD COLUMN IF NOT EXISTS "rate" DOUBLE PRECISION;
ALTER TABLE "Rebate" ADD COLUMN IF NOT EXISTS "betAmount" DOUBLE PRECISION;
ALTER TABLE "Rebate" ADD COLUMN IF NOT EXISTS "betId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "RebateRateConfig" (
    "id" TEXT NOT NULL,
    "vipLevel" INTEGER NOT NULL,
    "category" "RebateGameCategory" NOT NULL,
    "layer1" DOUBLE PRECISION NOT NULL,
    "layer2" DOUBLE PRECISION NOT NULL,
    "layer3" DOUBLE PRECISION NOT NULL,
    "layer4" DOUBLE PRECISION NOT NULL,
    "layer5" DOUBLE PRECISION NOT NULL,
    "layer6" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RebateRateConfig_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "Rebate_userId_createdAt_idx" ON "Rebate"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "Rebate_userId_settled_idx" ON "Rebate"("userId", "settled");
CREATE INDEX IF NOT EXISTS "Rebate_gameCategory_idx" ON "Rebate"("gameCategory");
CREATE INDEX IF NOT EXISTS "Rebate_fromUserId_idx" ON "Rebate"("fromUserId");

CREATE UNIQUE INDEX IF NOT EXISTS "RebateRateConfig_vipLevel_category_key" ON "RebateRateConfig"("vipLevel", "category");
CREATE INDEX IF NOT EXISTS "RebateRateConfig_category_idx" ON "RebateRateConfig"("category");
CREATE INDEX IF NOT EXISTS "RebateRateConfig_vipLevel_idx" ON "RebateRateConfig"("vipLevel");

-- FK
DO $$ BEGIN
  ALTER TABLE "Rebate" ADD CONSTRAINT "Rebate_fromUserId_fkey"
    FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
