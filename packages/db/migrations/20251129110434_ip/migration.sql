/*
  Warnings:

  - You are about to drop the column `isBlocked` on the `Ip` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Ip" DROP COLUMN "isBlocked",
ADD COLUMN     "isBlacklisted" BOOLEAN NOT NULL DEFAULT false;
