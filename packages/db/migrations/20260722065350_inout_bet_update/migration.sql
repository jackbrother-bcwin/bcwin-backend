/*
  Warnings:

  - Added the required column `winAmount` to the `InoutBet` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Config" ALTER COLUMN "inrToUsdtPaymentConversionRate" SET DEFAULT 105.0,
ALTER COLUMN "inrToUsdtWithdrawalConversionRate" SET DEFAULT 100.0;

-- AlterTable
ALTER TABLE "InoutBet" ADD COLUMN     "isSettled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "winAmount" DOUBLE PRECISION NOT NULL;
