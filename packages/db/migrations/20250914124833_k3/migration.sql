-- CreateEnum
CREATE TYPE "public"."K3PeriodStatus" AS ENUM ('ACTIVE', 'ENDED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "public"."K3BetType" AS ENUM ('SUM', 'TRIPLE_ANY', 'TRIPLE_SPECIFIC', 'DOUBLE_ANY', 'DOUBLE_SPECIFIC', 'ALL_DIFFERENT', 'TWO_NUMBERS', 'CONSECUTIVE', 'BIG', 'SMALL', 'ODD', 'EVEN');

-- CreateEnum
CREATE TYPE "public"."K3BetStatus" AS ENUM ('PENDING', 'WON', 'LOST');

-- CreateTable
CREATE TABLE "public"."K3Period" (
    "id" TEXT NOT NULL,
    "periodNumber" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "dice1" INTEGER,
    "dice2" INTEGER,
    "dice3" INTEGER,
    "sum" INTEGER,
    "isTriple" BOOLEAN,
    "isDouble" BOOLEAN,
    "isAllDifferent" BOOLEAN,
    "isConsecutive" BOOLEAN,
    "isBig" BOOLEAN,
    "isSmall" BOOLEAN,
    "isOdd" BOOLEAN,
    "isEven" BOOLEAN,
    "status" "public"."K3PeriodStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "K3Period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."K3Bet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "betAmount" DOUBLE PRECISION NOT NULL,
    "contractAmount" DOUBLE PRECISION NOT NULL,
    "betType" "public"."K3BetType" NOT NULL,
    "betChoice" TEXT NOT NULL,
    "status" "public"."K3BetStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "K3Bet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."K3BetResult" (
    "id" TEXT NOT NULL,
    "betId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "isWin" BOOLEAN NOT NULL,
    "winAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "multiplier" DOUBLE PRECISION,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "K3BetResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "K3Period_periodNumber_key" ON "public"."K3Period"("periodNumber");

-- CreateIndex
CREATE INDEX "K3Period_durationSeconds_idx" ON "public"."K3Period"("durationSeconds");

-- CreateIndex
CREATE INDEX "K3Period_startTime_idx" ON "public"."K3Period"("startTime");

-- CreateIndex
CREATE INDEX "K3Period_status_idx" ON "public"."K3Period"("status");

-- CreateIndex
CREATE INDEX "K3Period_periodNumber_idx" ON "public"."K3Period"("periodNumber");

-- CreateIndex
CREATE INDEX "K3Bet_userId_idx" ON "public"."K3Bet"("userId");

-- CreateIndex
CREATE INDEX "K3Bet_periodId_idx" ON "public"."K3Bet"("periodId");

-- CreateIndex
CREATE INDEX "K3Bet_status_idx" ON "public"."K3Bet"("status");

-- CreateIndex
CREATE INDEX "K3Bet_betType_idx" ON "public"."K3Bet"("betType");

-- CreateIndex
CREATE INDEX "K3Bet_createdAt_idx" ON "public"."K3Bet"("createdAt");

-- CreateIndex
CREATE INDEX "K3Bet_userId_periodId_idx" ON "public"."K3Bet"("userId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "K3BetResult_betId_key" ON "public"."K3BetResult"("betId");

-- CreateIndex
CREATE INDEX "K3BetResult_periodId_idx" ON "public"."K3BetResult"("periodId");

-- CreateIndex
CREATE INDEX "K3BetResult_isWin_idx" ON "public"."K3BetResult"("isWin");

-- CreateIndex
CREATE INDEX "K3BetResult_processedAt_idx" ON "public"."K3BetResult"("processedAt");

-- AddForeignKey
ALTER TABLE "public"."K3Bet" ADD CONSTRAINT "K3Bet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."K3Bet" ADD CONSTRAINT "K3Bet_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "public"."K3Period"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."K3BetResult" ADD CONSTRAINT "K3BetResult_betId_fkey" FOREIGN KEY ("betId") REFERENCES "public"."K3Bet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."K3BetResult" ADD CONSTRAINT "K3BetResult_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "public"."K3Period"("id") ON DELETE CASCADE ON UPDATE CASCADE;
