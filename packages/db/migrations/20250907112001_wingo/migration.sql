-- CreateEnum
CREATE TYPE "public"."WingoPeriodStatus" AS ENUM ('ACTIVE', 'ENDED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "public"."WingoBetType" AS ENUM ('COLOR', 'NUMBER', 'SIZE');

-- CreateEnum
CREATE TYPE "public"."WingoBetStatus" AS ENUM ('PENDING', 'WON', 'LOST');

-- CreateTable
CREATE TABLE "public"."WingoPeriod" (
    "id" TEXT NOT NULL,
    "periodNumber" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "resultNumber" INTEGER,
    "resultColor" TEXT,
    "resultSize" TEXT,
    "status" "public"."WingoPeriodStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WingoPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WingoBet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "betAmount" DOUBLE PRECISION NOT NULL,
    "contractAmount" DOUBLE PRECISION NOT NULL,
    "betType" "public"."WingoBetType" NOT NULL,
    "betChoice" TEXT NOT NULL,
    "status" "public"."WingoBetStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WingoBet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WingoBetResult" (
    "id" TEXT NOT NULL,
    "betId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "isWin" BOOLEAN NOT NULL,
    "winAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "multiplier" DOUBLE PRECISION,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WingoBetResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WingoPeriod_periodNumber_key" ON "public"."WingoPeriod"("periodNumber");

-- CreateIndex
CREATE INDEX "WingoPeriod_durationSeconds_idx" ON "public"."WingoPeriod"("durationSeconds");

-- CreateIndex
CREATE INDEX "WingoPeriod_startTime_idx" ON "public"."WingoPeriod"("startTime");

-- CreateIndex
CREATE INDEX "WingoPeriod_status_idx" ON "public"."WingoPeriod"("status");

-- CreateIndex
CREATE INDEX "WingoPeriod_periodNumber_idx" ON "public"."WingoPeriod"("periodNumber");

-- CreateIndex
CREATE INDEX "WingoBet_userId_idx" ON "public"."WingoBet"("userId");

-- CreateIndex
CREATE INDEX "WingoBet_periodId_idx" ON "public"."WingoBet"("periodId");

-- CreateIndex
CREATE INDEX "WingoBet_status_idx" ON "public"."WingoBet"("status");

-- CreateIndex
CREATE INDEX "WingoBet_betType_idx" ON "public"."WingoBet"("betType");

-- CreateIndex
CREATE INDEX "WingoBet_createdAt_idx" ON "public"."WingoBet"("createdAt");

-- CreateIndex
CREATE INDEX "WingoBet_userId_periodId_idx" ON "public"."WingoBet"("userId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "WingoBetResult_betId_key" ON "public"."WingoBetResult"("betId");

-- CreateIndex
CREATE INDEX "WingoBetResult_periodId_idx" ON "public"."WingoBetResult"("periodId");

-- CreateIndex
CREATE INDEX "WingoBetResult_isWin_idx" ON "public"."WingoBetResult"("isWin");

-- CreateIndex
CREATE INDEX "WingoBetResult_processedAt_idx" ON "public"."WingoBetResult"("processedAt");

-- AddForeignKey
ALTER TABLE "public"."WingoBet" ADD CONSTRAINT "WingoBet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WingoBet" ADD CONSTRAINT "WingoBet_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "public"."WingoPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WingoBetResult" ADD CONSTRAINT "WingoBetResult_betId_fkey" FOREIGN KEY ("betId") REFERENCES "public"."WingoBet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WingoBetResult" ADD CONSTRAINT "WingoBetResult_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "public"."WingoPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
