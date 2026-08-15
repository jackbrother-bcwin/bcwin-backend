/*
  Warnings:

  - The `resultColor` column on the `WingoPeriod` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `resultSize` column on the `WingoPeriod` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "public"."WingoResultColor" AS ENUM ('RED', 'GREEN', 'VIOLET');

-- CreateEnum
CREATE TYPE "public"."WingoResultSize" AS ENUM ('BIG', 'SMALL');

-- AlterTable
ALTER TABLE "public"."WingoPeriod" DROP COLUMN "resultColor",
ADD COLUMN     "resultColor" "public"."WingoResultColor",
DROP COLUMN "resultSize",
ADD COLUMN     "resultSize" "public"."WingoResultSize";
