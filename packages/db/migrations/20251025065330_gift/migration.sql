/*
  Warnings:

  - Added the required column `type` to the `Gift` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."GiftType" AS ENUM ('FIXED', 'UPTO');

-- AlterTable
ALTER TABLE "public"."Gift" ADD COLUMN     "description" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "title" TEXT,
ADD COLUMN     "type" "public"."GiftType" NOT NULL,
ADD COLUMN     "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "validTill" TIMESTAMP(3);
