/*
  Warnings:

  - Added the required column `gameName` to the `GreytopBet` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "GreytopBet" ADD COLUMN     "gameName" TEXT NOT NULL;
