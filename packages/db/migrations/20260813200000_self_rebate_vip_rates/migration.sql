-- ADR-0021: self-rebate % by XP VIP (currentLevel)

CREATE TABLE IF NOT EXISTS "SelfRebateRateConfig" (
    "id" TEXT NOT NULL,
    "vipLevel" INTEGER NOT NULL,
    "ratePercent" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfRebateRateConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SelfRebateRateConfig_vipLevel_key" ON "SelfRebateRateConfig"("vipLevel");

ALTER TABLE "SelfRebate" ADD COLUMN IF NOT EXISTS "vipLevel" INTEGER;

INSERT INTO "SelfRebateRateConfig" ("id", "vipLevel", "ratePercent", "createdAt", "updatedAt")
VALUES
    ('srrc-vip-0', 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('srrc-vip-1', 1, 0.05, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('srrc-vip-2', 2, 0.05, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('srrc-vip-3', 3, 0.1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('srrc-vip-4', 4, 0.1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('srrc-vip-5', 5, 0.1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('srrc-vip-6', 6, 0.15, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('srrc-vip-7', 7, 0.15, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('srrc-vip-8', 8, 0.15, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('srrc-vip-9', 9, 0.2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('srrc-vip-10', 10, 0.3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("vipLevel") DO UPDATE SET
    "ratePercent" = EXCLUDED."ratePercent",
    "updatedAt" = CURRENT_TIMESTAMP;
