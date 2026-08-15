/*
  Warnings:

  - You are about to drop the column `minBetForWithdraw` on the `Config` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Config" DROP COLUMN "minBetForWithdraw",
ADD COLUMN     "wager" DOUBLE PRECISION NOT NULL DEFAULT 1;
