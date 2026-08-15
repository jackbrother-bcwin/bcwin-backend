/*
  Warnings:

  - You are about to drop the column `tronAddress` on the `Bank` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Bank" DROP COLUMN "tronAddress",
ADD COLUMN     "bep20Address" TEXT,
ADD COLUMN     "trc20Address" TEXT;

-- AlterTable
ALTER TABLE "Withdraw" ADD COLUMN     "cryptoChain" TEXT,
ADD COLUMN     "metadata" JSONB;
