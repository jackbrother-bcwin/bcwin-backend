/*
  Warnings:

  - You are about to drop the column `inrToUsdtPayment` on the `Config` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Config" DROP COLUMN "inrToUsdtPayment",
ADD COLUMN     "inrToUsdtWithdrawalConversionRate" DOUBLE PRECISION NOT NULL DEFAULT 90.0;
