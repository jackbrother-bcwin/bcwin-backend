/*
  Warnings:

  - Changed the column `gameType` on the `GreytopBet` table from a scalar field to a list field. If there are non-null values in that column, this step will fail.

*/
-- AlterTable
-- Convert single gameType to an array by wrapping it in ARRAY[]
ALTER TABLE "GreytopBet" ALTER COLUMN "gameType" SET DATA TYPE "GreytopGameType"[] USING ARRAY["gameType"]::"GreytopGameType"[];
