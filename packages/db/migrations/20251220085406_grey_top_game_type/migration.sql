/*
  Warnings:

  - Added the required column `gameType` to the `GreytopBet` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "GreytopBet" ADD COLUMN     "gameType" "GreytopGameType" NOT NULL;
