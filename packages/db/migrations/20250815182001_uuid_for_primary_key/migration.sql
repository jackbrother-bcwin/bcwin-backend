/*
  Warnings:

  - The primary key for the `Bank` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Deposit` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Gift` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `GiftRedemption` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Otp` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `User` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Withdraw` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- DropForeignKey
ALTER TABLE "public"."Bank" DROP CONSTRAINT "Bank_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Deposit" DROP CONSTRAINT "Deposit_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."GiftRedemption" DROP CONSTRAINT "GiftRedemption_giftId_fkey";

-- DropForeignKey
ALTER TABLE "public"."GiftRedemption" DROP CONSTRAINT "GiftRedemption_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Withdraw" DROP CONSTRAINT "Withdraw_userId_fkey";

-- AlterTable
ALTER TABLE "public"."Bank" DROP CONSTRAINT "Bank_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "userId" SET DATA TYPE TEXT,
ADD CONSTRAINT "Bank_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Bank_id_seq";

-- AlterTable
ALTER TABLE "public"."Deposit" DROP CONSTRAINT "Deposit_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "userId" SET DATA TYPE TEXT,
ADD CONSTRAINT "Deposit_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Deposit_id_seq";

-- AlterTable
ALTER TABLE "public"."Gift" DROP CONSTRAINT "Gift_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "Gift_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Gift_id_seq";

-- AlterTable
ALTER TABLE "public"."GiftRedemption" DROP CONSTRAINT "GiftRedemption_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "userId" SET DATA TYPE TEXT,
ALTER COLUMN "giftId" SET DATA TYPE TEXT,
ADD CONSTRAINT "GiftRedemption_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "GiftRedemption_id_seq";

-- AlterTable
ALTER TABLE "public"."Otp" DROP CONSTRAINT "Otp_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "Otp_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Otp_id_seq";

-- AlterTable
ALTER TABLE "public"."User" DROP CONSTRAINT "User_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "User_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "User_id_seq";

-- AlterTable
ALTER TABLE "public"."Withdraw" DROP CONSTRAINT "Withdraw_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "userId" SET DATA TYPE TEXT,
ADD CONSTRAINT "Withdraw_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Withdraw_id_seq";

-- AddForeignKey
ALTER TABLE "public"."Bank" ADD CONSTRAINT "Bank_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Deposit" ADD CONSTRAINT "Deposit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Withdraw" ADD CONSTRAINT "Withdraw_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GiftRedemption" ADD CONSTRAINT "GiftRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GiftRedemption" ADD CONSTRAINT "GiftRedemption_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "public"."Gift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
