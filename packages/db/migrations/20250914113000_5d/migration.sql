-- CreateEnum
CREATE TYPE "public"."FiveDPeriodStatus" AS ENUM ('ACTIVE', 'ENDED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "public"."FiveDBetType" AS ENUM ('EXACT_NUMBER', 'LOW', 'HIGH', 'ODD', 'EVEN', 'SUM_EXACT');

-- CreateEnum
CREATE TYPE "public"."FiveDBetCategory" AS ENUM ('POSITION', 'SUM');

-- CreateEnum
CREATE TYPE "public"."FiveDBetStatus" AS ENUM ('PENDING', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "public"."FiveDPosition" AS ENUM ('A', 'B', 'C', 'D', 'E');

-- CreateTable
CREATE TABLE "public"."FiveDPeriod" (
    "id" TEXT NOT NULL,
    "periodNumber" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "resultNumber" TEXT,
    "resultDigitA" INTEGER,
    "resultDigitB" INTEGER,
    "resultDigitC" INTEGER,
    "resultDigitD" INTEGER,
    "resultDigitE" INTEGER,
    "resultSum" INTEGER,
    "status" "public"."FiveDPeriodStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiveDPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FiveDBet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "betAmount" DOUBLE PRECISION NOT NULL,
    "contractAmount" DOUBLE PRECISION NOT NULL,
    "betType" "public"."FiveDBetType" NOT NULL,
    "betCategory" "public"."FiveDBetCategory" NOT NULL,
    "betChoice" TEXT NOT NULL,
    "position" "public"."FiveDPosition",
    "status" "public"."FiveDBetStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiveDBet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FiveDBetResult" (
    "id" TEXT NOT NULL,
    "betId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "isWin" BOOLEAN NOT NULL,
    "winAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "multiplier" DOUBLE PRECISION,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiveDBetResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FiveDPeriod_periodNumber_key" ON "public"."FiveDPeriod"("periodNumber");

-- CreateIndex
CREATE INDEX "FiveDPeriod_durationSeconds_idx" ON "public"."FiveDPeriod"("durationSeconds");

-- CreateIndex
CREATE INDEX "FiveDPeriod_startTime_idx" ON "public"."FiveDPeriod"("startTime");

-- CreateIndex
CREATE INDEX "FiveDPeriod_status_idx" ON "public"."FiveDPeriod"("status");

-- CreateIndex
CREATE INDEX "FiveDPeriod_periodNumber_idx" ON "public"."FiveDPeriod"("periodNumber");

-- CreateIndex
CREATE INDEX "FiveDBet_userId_idx" ON "public"."FiveDBet"("userId");

-- CreateIndex
CREATE INDEX "FiveDBet_periodId_idx" ON "public"."FiveDBet"("periodId");

-- CreateIndex
CREATE INDEX "FiveDBet_status_idx" ON "public"."FiveDBet"("status");

-- CreateIndex
CREATE INDEX "FiveDBet_betType_idx" ON "public"."FiveDBet"("betType");

-- CreateIndex
CREATE INDEX "FiveDBet_betCategory_idx" ON "public"."FiveDBet"("betCategory");

-- CreateIndex
CREATE INDEX "FiveDBet_position_idx" ON "public"."FiveDBet"("position");

-- CreateIndex
CREATE INDEX "FiveDBet_createdAt_idx" ON "public"."FiveDBet"("createdAt");

-- CreateIndex
CREATE INDEX "FiveDBet_userId_periodId_idx" ON "public"."FiveDBet"("userId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "FiveDBetResult_betId_key" ON "public"."FiveDBetResult"("betId");

-- CreateIndex
CREATE INDEX "FiveDBetResult_periodId_idx" ON "public"."FiveDBetResult"("periodId");

-- CreateIndex
CREATE INDEX "FiveDBetResult_isWin_idx" ON "public"."FiveDBetResult"("isWin");

-- CreateIndex
CREATE INDEX "FiveDBetResult_processedAt_idx" ON "public"."FiveDBetResult"("processedAt");

-- AddForeignKey
ALTER TABLE "public"."FiveDBet" ADD CONSTRAINT "FiveDBet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FiveDBet" ADD CONSTRAINT "FiveDBet_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "public"."FiveDPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FiveDBetResult" ADD CONSTRAINT "FiveDBetResult_betId_fkey" FOREIGN KEY ("betId") REFERENCES "public"."FiveDBet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FiveDBetResult" ADD CONSTRAINT "FiveDBetResult_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "public"."FiveDPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
