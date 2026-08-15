-- CreateEnum
CREATE TYPE "public"."Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "public"."PaymentOrderStatus" AS ENUM ('PROCESSING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."WithdrawOrderStatus" AS ENUM ('GENERATED', 'PROCESSING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "mobileNumber" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "referralCode" TEXT NOT NULL,
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "referredBy" TEXT,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "role" "public"."Role" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Bank" (
    "id" SERIAL NOT NULL,
    "fullName" TEXT NOT NULL,
    "bankAccount" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "tronAddress" TEXT,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Deposit" (
    "id" SERIAL NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "status" "public"."PaymentOrderStatus" NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Withdraw" (
    "id" SERIAL NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "status" "public"."WithdrawOrderStatus" NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Withdraw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Otp" (
    "id" SERIAL NOT NULL,
    "mobileNumber" TEXT NOT NULL,
    "otp" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Otp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Gift" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "totalRedeemable" INTEGER NOT NULL,
    "totalRedeemed" INTEGER NOT NULL,
    "exaushted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Gift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GiftRedemption" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "giftId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "public"."User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_mobileNumber_key" ON "public"."User"("mobileNumber");

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "public"."User"("referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "Bank_userId_key" ON "public"."Bank"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Deposit_orderId_key" ON "public"."Deposit"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Withdraw_orderId_key" ON "public"."Withdraw"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Otp_mobileNumber_key" ON "public"."Otp"("mobileNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Gift_code_key" ON "public"."Gift"("code");

-- CreateIndex
CREATE UNIQUE INDEX "GiftRedemption_userId_giftId_key" ON "public"."GiftRedemption"("userId", "giftId");

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
