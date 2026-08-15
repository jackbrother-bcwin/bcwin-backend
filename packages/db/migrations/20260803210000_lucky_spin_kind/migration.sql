-- CreateEnum
CREATE TYPE "SpinWheelKind" AS ENUM ('INVITE', 'LUCKY');

-- AlterTable SpinWheel
ALTER TABLE "SpinWheel" ADD COLUMN IF NOT EXISTS "luckyAvailableSpins" INTEGER NOT NULL DEFAULT 0;

-- AlterTable LuckySpinRule
ALTER TABLE "LuckySpinRule" ADD COLUMN IF NOT EXISTS "kind" "SpinWheelKind" NOT NULL DEFAULT 'INVITE';

-- AlterTable LuckySpinReward
ALTER TABLE "LuckySpinReward" ADD COLUMN IF NOT EXISTS "kind" "SpinWheelKind" NOT NULL DEFAULT 'INVITE';

-- Indexes
CREATE INDEX IF NOT EXISTS "LuckySpinRule_kind_isActive_idx" ON "LuckySpinRule"("kind", "isActive");
CREATE INDEX IF NOT EXISTS "LuckySpinReward_kind_isActive_idx" ON "LuckySpinReward"("kind", "isActive");
