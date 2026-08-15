-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('GLOBAL', 'GLOBAL1');

-- CreateEnum
CREATE TYPE "NotificationImportance" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "SalaryFrequency" AS ENUM ('HOURLY', 'DAILY', 'MONTHLY', 'ONE_TIME');

-- AlterTable
ALTER TABLE "Bank" ADD COLUMN     "accountType" TEXT,
ADD COLUMN     "bankName" TEXT;

-- AlterTable
ALTER TABLE "VipLevelRequirement" ADD COLUMN     "minBet" DOUBLE PRECISION,
ADD COLUMN     "monthlyBonus" DOUBLE PRECISION,
ADD COLUMN     "oneTimeBonus" DOUBLE PRECISION,
ADD COLUMN     "rebatePercentage" DOUBLE PRECISION,
ADD COLUMN     "vipName" TEXT;

-- CreateTable
CREATE TABLE "ActivityBonusTier" (
    "id" TEXT NOT NULL,
    "type" "ActivityBonusType" NOT NULL,
    "depositRequirement" DOUBLE PRECISION,
    "betRequirement" DOUBLE PRECISION,
    "inviteRequirement" INTEGER,
    "dayRequirement" INTEGER,
    "reward" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityBonusTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL DEFAULT 'GLOBAL',
    "importance" "NotificationImportance" NOT NULL DEFAULT 'LOW',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "frequency" "SalaryFrequency" NOT NULL,
    "maxPayments" INTEGER NOT NULL,
    "paidCount" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3) NOT NULL,
    "nextPaymentAt" TIMESTAMP(3) NOT NULL,
    "immediateFirst" BOOLEAN NOT NULL DEFAULT false,
    "addToTurnover" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryPayment" (
    "id" TEXT NOT NULL,
    "salaryRuleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LuckySpinRule" (
    "id" TEXT NOT NULL,
    "minDeposit" DOUBLE PRECISION NOT NULL,
    "spinChances" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LuckySpinRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LuckySpinReward" (
    "id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "probability" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LuckySpinReward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityBonusTier_type_idx" ON "ActivityBonusTier"("type");

-- CreateIndex
CREATE INDEX "ActivityBonusTier_depositRequirement_idx" ON "ActivityBonusTier"("depositRequirement");

-- CreateIndex
CREATE INDEX "ActivityBonusTier_betRequirement_idx" ON "ActivityBonusTier"("betRequirement");

-- CreateIndex
CREATE INDEX "ActivityBonusTier_inviteRequirement_idx" ON "ActivityBonusTier"("inviteRequirement");

-- CreateIndex
CREATE INDEX "ActivityBonusTier_dayRequirement_idx" ON "ActivityBonusTier"("dayRequirement");

-- CreateIndex
CREATE INDEX "Notification_type_idx" ON "Notification"("type");

-- CreateIndex
CREATE INDEX "Notification_isActive_idx" ON "Notification"("isActive");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "SalaryRule_userId_idx" ON "SalaryRule"("userId");

-- CreateIndex
CREATE INDEX "SalaryRule_isActive_idx" ON "SalaryRule"("isActive");

-- CreateIndex
CREATE INDEX "SalaryRule_nextPaymentAt_idx" ON "SalaryRule"("nextPaymentAt");

-- CreateIndex
CREATE INDEX "SalaryRule_isActive_nextPaymentAt_idx" ON "SalaryRule"("isActive", "nextPaymentAt");

-- CreateIndex
CREATE INDEX "SalaryPayment_userId_idx" ON "SalaryPayment"("userId");

-- CreateIndex
CREATE INDEX "SalaryPayment_salaryRuleId_idx" ON "SalaryPayment"("salaryRuleId");

-- CreateIndex
CREATE INDEX "SalaryPayment_createdAt_idx" ON "SalaryPayment"("createdAt");

-- CreateIndex
CREATE INDEX "LuckySpinRule_isActive_idx" ON "LuckySpinRule"("isActive");

-- CreateIndex
CREATE INDEX "LuckySpinReward_isActive_idx" ON "LuckySpinReward"("isActive");

-- AddForeignKey
ALTER TABLE "SalaryRule" ADD CONSTRAINT "SalaryRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryPayment" ADD CONSTRAINT "SalaryPayment_salaryRuleId_fkey" FOREIGN KEY ("salaryRuleId") REFERENCES "SalaryRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryPayment" ADD CONSTRAINT "SalaryPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
