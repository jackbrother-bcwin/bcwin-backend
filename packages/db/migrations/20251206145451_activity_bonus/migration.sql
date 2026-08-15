-- CreateEnum
CREATE TYPE "ActivityBonusType" AS ENUM ('WEEKLY', 'DAILY', 'INVITATION', 'FIRST_DEPOSIT', 'ATTENDENCE');

-- CreateEnum
CREATE TYPE "ActivityBonusStatus" AS ENUM ('PENDING', 'COMPLETED_UNCOLLECTED', 'COLLECTED', 'EXPIRED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastLoginDate" TIMESTAMP(3),
ADD COLUMN     "loginStreak" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ActivityBonus" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "ActivityBonusType" NOT NULL,
    "status" "ActivityBonusStatus" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "metadata" JSONB,
    "expiresAt" TIMESTAMP(3),
    "claimAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityBonus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityBonus_userId_idx" ON "ActivityBonus"("userId");

-- CreateIndex
CREATE INDEX "ActivityBonus_type_idx" ON "ActivityBonus"("type");

-- CreateIndex
CREATE INDEX "ActivityBonus_status_idx" ON "ActivityBonus"("status");

-- CreateIndex
CREATE INDEX "ActivityBonus_expiresAt_idx" ON "ActivityBonus"("expiresAt");

-- CreateIndex
CREATE INDEX "ActivityBonus_userId_type_status_idx" ON "ActivityBonus"("userId", "type", "status");

-- CreateIndex
CREATE INDEX "ActivityBonus_userId_type_status_expiresAt_idx" ON "ActivityBonus"("userId", "type", "status", "expiresAt");

-- AddForeignKey
ALTER TABLE "ActivityBonus" ADD CONSTRAINT "ActivityBonus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
