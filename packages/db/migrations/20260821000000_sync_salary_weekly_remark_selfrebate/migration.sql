-- Migration: Sync schema changes applied via db push
-- These changes are already present in the database.

-- 1. Add WEEKLY variant to SalaryFrequency enum
ALTER TYPE "SalaryFrequency" ADD VALUE IF NOT EXISTS 'WEEKLY';

-- 2. Add remark column to SalaryRule
ALTER TABLE "SalaryRule" ADD COLUMN IF NOT EXISTS "remark" TEXT;

-- 3. Make maxPayments nullable with default 0
ALTER TABLE "SalaryRule" ALTER COLUMN "maxPayments" SET DEFAULT 0;
ALTER TABLE "SalaryRule" ALTER COLUMN "maxPayments" DROP NOT NULL;

-- 4. Make salaryRuleId nullable on SalaryPayment
ALTER TABLE "SalaryPayment" ALTER COLUMN "salaryRuleId" DROP NOT NULL;

-- 5. Add remark column to SalaryPayment
ALTER TABLE "SalaryPayment" ADD COLUMN IF NOT EXISTS "remark" TEXT;

-- 6. Create SelfRebateRateConfig table (if not exists)
CREATE TABLE IF NOT EXISTS "SelfRebateRateConfig" (
    "id" TEXT NOT NULL,
    "vipLevel" INTEGER NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfRebateRateConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SelfRebateRateConfig_vipLevel_key" ON "SelfRebateRateConfig"("vipLevel");

-- 7. Add vipLevel column to SelfRebate
ALTER TABLE "SelfRebate" ADD COLUMN IF NOT EXISTS "vipLevel" INTEGER;
