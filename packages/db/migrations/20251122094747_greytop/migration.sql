/*
  Warnings:

  - Changed the type of `winAmount` on the `GreytopBet` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `betAmount` on the `GreytopBet` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "GreytopBet" DROP COLUMN "winAmount",
ADD COLUMN     "winAmount" DOUBLE PRECISION NOT NULL,
DROP COLUMN "betAmount",
ADD COLUMN     "betAmount" DOUBLE PRECISION NOT NULL;
