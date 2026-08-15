-- CreateEnum
CREATE TYPE "public"."MotoPeriodStatus" AS ENUM ('ACTIVE', 'ENDED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "public"."MotoBetType" AS ENUM ('POSITION', 'ODD_EVEN', 'BIG_SMALL');

-- CreateEnum
CREATE TYPE "public"."MotoPosition" AS ENUM ('FIRST', 'SECOND', 'THIRD');

-- CreateEnum
CREATE TYPE "public"."MotoBetStatus" AS ENUM ('PENDING', 'WON', 'LOST');

-- CreateTable
CREATE TABLE "public"."MotoPeriod" (
    "id" TEXT NOT NULL,
    "periodNumber" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "firstPlace" INTEGER,
    "secondPlace" INTEGER,
    "thirdPlace" INTEGER,
    "status" "public"."MotoPeriodStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MotoPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MotoBet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "betAmount" DOUBLE PRECISION NOT NULL,
    "contractAmount" DOUBLE PRECISION NOT NULL,
    "betType" "public"."MotoBetType" NOT NULL,
    "betChoice" TEXT NOT NULL,
    "targetPosition" "public"."MotoPosition" NOT NULL,
    "status" "public"."MotoBetStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MotoBet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MotoBetResult" (
    "id" TEXT NOT NULL,
    "betId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "isWin" BOOLEAN NOT NULL,
    "winAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "multiplier" DOUBLE PRECISION,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MotoBetResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MotoPeriod_periodNumber_key" ON "public"."MotoPeriod"("periodNumber");

-- CreateIndex
CREATE INDEX "MotoPeriod_durationSeconds_idx" ON "public"."MotoPeriod"("durationSeconds");

-- CreateIndex
CREATE INDEX "MotoPeriod_startTime_idx" ON "public"."MotoPeriod"("startTime");

-- CreateIndex
CREATE INDEX "MotoPeriod_status_idx" ON "public"."MotoPeriod"("status");

-- CreateIndex
CREATE INDEX "MotoPeriod_periodNumber_idx" ON "public"."MotoPeriod"("periodNumber");

-- CreateIndex
CREATE INDEX "MotoBet_userId_idx" ON "public"."MotoBet"("userId");

-- CreateIndex
CREATE INDEX "MotoBet_periodId_idx" ON "public"."MotoBet"("periodId");

-- CreateIndex
CREATE INDEX "MotoBet_status_idx" ON "public"."MotoBet"("status");

-- CreateIndex
CREATE INDEX "MotoBet_betType_idx" ON "public"."MotoBet"("betType");

-- CreateIndex
CREATE INDEX "MotoBet_createdAt_idx" ON "public"."MotoBet"("createdAt");

-- CreateIndex
CREATE INDEX "MotoBet_userId_periodId_idx" ON "public"."MotoBet"("userId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "MotoBetResult_betId_key" ON "public"."MotoBetResult"("betId");

-- CreateIndex
CREATE INDEX "MotoBetResult_periodId_idx" ON "public"."MotoBetResult"("periodId");

-- CreateIndex
CREATE INDEX "MotoBetResult_isWin_idx" ON "public"."MotoBetResult"("isWin");

-- CreateIndex
CREATE INDEX "MotoBetResult_processedAt_idx" ON "public"."MotoBetResult"("processedAt");

-- AddForeignKey
ALTER TABLE "public"."MotoBet" ADD CONSTRAINT "MotoBet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MotoBet" ADD CONSTRAINT "MotoBet_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "public"."MotoPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MotoBetResult" ADD CONSTRAINT "MotoBetResult_betId_fkey" FOREIGN KEY ("betId") REFERENCES "public"."MotoBet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MotoBetResult" ADD CONSTRAINT "MotoBetResult_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "public"."MotoPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
