/*
  Warnings:

  - A unique constraint covering the columns `[periodNumber,durationSeconds]` on the table `WingoPeriod` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "WingoPeriod_periodNumber_key";

-- CreateIndex
CREATE UNIQUE INDEX "WingoPeriod_periodNumber_durationSeconds_key" ON "WingoPeriod"("periodNumber", "durationSeconds");
