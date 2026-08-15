/*
  Warnings:

  - The `status` column on the `FiveDBet` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `FiveDPeriod` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `K3Bet` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `K3Period` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `MotoBet` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `MotoPeriod` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `TrxWingoBet` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `TrxWingoPeriod` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `WingoBet` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `WingoPeriod` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "public"."PeriodStatus" AS ENUM ('ACTIVE', 'ENDED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "public"."BetStatus" AS ENUM ('PENDING', 'WON', 'LOST');

-- AlterTable
ALTER TABLE "public"."FiveDBet" DROP COLUMN "status",
ADD COLUMN     "status" "public"."BetStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "public"."FiveDPeriod" DROP COLUMN "status",
ADD COLUMN     "status" "public"."PeriodStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "public"."K3Bet" DROP COLUMN "status",
ADD COLUMN     "status" "public"."BetStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "public"."K3Period" DROP COLUMN "status",
ADD COLUMN     "status" "public"."PeriodStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "public"."MotoBet" DROP COLUMN "status",
ADD COLUMN     "status" "public"."BetStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "public"."MotoPeriod" DROP COLUMN "status",
ADD COLUMN     "status" "public"."PeriodStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "public"."TrxWingoBet" DROP COLUMN "status",
ADD COLUMN     "status" "public"."BetStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "public"."TrxWingoPeriod" DROP COLUMN "status",
ADD COLUMN     "status" "public"."PeriodStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "public"."WingoBet" DROP COLUMN "status",
ADD COLUMN     "status" "public"."BetStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "public"."WingoPeriod" DROP COLUMN "status",
ADD COLUMN     "status" "public"."PeriodStatus" NOT NULL DEFAULT 'ACTIVE';

-- DropEnum
DROP TYPE "public"."FiveDBetStatus";

-- DropEnum
DROP TYPE "public"."FiveDPeriodStatus";

-- DropEnum
DROP TYPE "public"."K3BetStatus";

-- DropEnum
DROP TYPE "public"."K3PeriodStatus";

-- DropEnum
DROP TYPE "public"."MotoBetStatus";

-- DropEnum
DROP TYPE "public"."MotoPeriodStatus";

-- DropEnum
DROP TYPE "public"."WingoBetStatus";

-- DropEnum
DROP TYPE "public"."WingoPeriodStatus";

-- CreateIndex
CREATE INDEX "FiveDBet_status_idx" ON "public"."FiveDBet"("status");

-- CreateIndex
CREATE INDEX "FiveDPeriod_status_idx" ON "public"."FiveDPeriod"("status");

-- CreateIndex
CREATE INDEX "K3Bet_status_idx" ON "public"."K3Bet"("status");

-- CreateIndex
CREATE INDEX "K3Period_status_idx" ON "public"."K3Period"("status");

-- CreateIndex
CREATE INDEX "MotoBet_status_idx" ON "public"."MotoBet"("status");

-- CreateIndex
CREATE INDEX "MotoPeriod_status_idx" ON "public"."MotoPeriod"("status");

-- CreateIndex
CREATE INDEX "TrxWingoBet_status_idx" ON "public"."TrxWingoBet"("status");

-- CreateIndex
CREATE INDEX "TrxWingoPeriod_status_idx" ON "public"."TrxWingoPeriod"("status");

-- CreateIndex
CREATE INDEX "WingoBet_status_idx" ON "public"."WingoBet"("status");

-- CreateIndex
CREATE INDEX "WingoPeriod_status_idx" ON "public"."WingoPeriod"("status");
