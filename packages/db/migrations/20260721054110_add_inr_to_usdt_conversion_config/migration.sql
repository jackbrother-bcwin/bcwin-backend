-- AlterTable
ALTER TABLE "Config" ADD COLUMN     "inrToUsdtPayment" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "inrToUsdtPaymentConversionRate" DOUBLE PRECISION NOT NULL DEFAULT 90.0;

-- AlterTable
ALTER TABLE "Deposit" ADD COLUMN     "usdtAmount" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Withdraw" ADD COLUMN     "usdtAmount" DOUBLE PRECISION;
