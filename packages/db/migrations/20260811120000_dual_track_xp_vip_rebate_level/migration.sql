-- ADR-0012: dual-track XP VIP (currentLevel) vs rebate level (rebateLevel)
-- rebateLevel keys RebateRateConfig; never driven by personal XP alone.

ALTER TABLE "UserVipLevel" ADD COLUMN IF NOT EXISTS "rebateLevel" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "UserVipLevel_rebateLevel_idx" ON "UserVipLevel"("rebateLevel");
