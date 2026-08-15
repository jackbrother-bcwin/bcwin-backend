/*
  Warnings:

  - A unique constraint covering the columns `[periodNumber,durationSeconds]` on the table `FiveDPeriod` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[periodNumber,durationSeconds]` on the table `K3Period` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[periodNumber,durationSeconds]` on the table `MotoPeriod` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[periodNumber,durationSeconds]` on the table `TrxWingoPeriod` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "FiveDPeriod_periodNumber_key";

-- DropIndex
DROP INDEX "K3Period_periodNumber_key";

-- DropIndex
DROP INDEX "MotoPeriod_periodNumber_key";

-- DropIndex
DROP INDEX "TrxWingoPeriod_periodNumber_key";

-- CreateIndex
CREATE UNIQUE INDEX "FiveDPeriod_periodNumber_durationSeconds_key" ON "FiveDPeriod"("periodNumber", "durationSeconds");

-- CreateIndex
CREATE UNIQUE INDEX "K3Period_periodNumber_durationSeconds_key" ON "K3Period"("periodNumber", "durationSeconds");

-- CreateIndex
CREATE UNIQUE INDEX "MotoPeriod_periodNumber_durationSeconds_key" ON "MotoPeriod"("periodNumber", "durationSeconds");

-- CreateIndex
CREATE UNIQUE INDEX "TrxWingoPeriod_periodNumber_durationSeconds_key" ON "TrxWingoPeriod"("periodNumber", "durationSeconds");
