-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "WagerRequirementType" AS ENUM ('RECHARGE', 'REWARD');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "Config" ADD COLUMN IF NOT EXISTS "rewardWagerFactor" DOUBLE PRECISION NOT NULL DEFAULT 1.0;

-- CreateTable (must match schema.prisma model WagerRequirement)
CREATE TABLE IF NOT EXISTS "WagerRequirement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceType" "WagerRequirementType" NOT NULL,
    "sourceId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "requiredWager" DOUBLE PRECISION NOT NULL,
    "wagerCleared" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isCleared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WagerRequirement_pkey" PRIMARY KEY ("id")
);

-- If an older incomplete table already exists (prod drift), add missing columns
ALTER TABLE "WagerRequirement" ADD COLUMN IF NOT EXISTS "amount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "WagerRequirement" ADD COLUMN IF NOT EXISTS "multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0;
ALTER TABLE "WagerRequirement" ADD COLUMN IF NOT EXISTS "wagerCleared" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WagerRequirement_userId_idx" ON "WagerRequirement"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WagerRequirement_createdAt_idx" ON "WagerRequirement"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WagerRequirement_userId_isCleared_idx" ON "WagerRequirement"("userId", "isCleared");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'WagerRequirement_userId_fkey'
    ) THEN
        ALTER TABLE "WagerRequirement" ADD CONSTRAINT "WagerRequirement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
