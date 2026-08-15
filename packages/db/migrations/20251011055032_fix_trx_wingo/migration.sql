-- CreateTable
CREATE TABLE "public"."TrxWingoPeriod" (
    "id" TEXT NOT NULL,
    "periodNumber" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "resultNumber" INTEGER,
    "resultColor" "public"."WingoResultColor",
    "resultSize" "public"."WingoResultSize",
    "status" "public"."WingoPeriodStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrxWingoPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TrxWingoBet" (
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

    CONSTRAINT "TrxWingoBet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TrxWingoBetResult" (
    "id" TEXT NOT NULL,
    "betId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "isWin" BOOLEAN NOT NULL,
    "winAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "multiplier" DOUBLE PRECISION,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrxWingoBetResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrxWingoPeriod_periodNumber_key" ON "public"."TrxWingoPeriod"("periodNumber");

-- CreateIndex
CREATE INDEX "TrxWingoPeriod_durationSeconds_idx" ON "public"."TrxWingoPeriod"("durationSeconds");

-- CreateIndex
CREATE INDEX "TrxWingoPeriod_startTime_idx" ON "public"."TrxWingoPeriod"("startTime");

-- CreateIndex
CREATE INDEX "TrxWingoPeriod_status_idx" ON "public"."TrxWingoPeriod"("status");

-- CreateIndex
CREATE INDEX "TrxWingoPeriod_periodNumber_idx" ON "public"."TrxWingoPeriod"("periodNumber");

-- CreateIndex
CREATE INDEX "TrxWingoBet_userId_idx" ON "public"."TrxWingoBet"("userId");

-- CreateIndex
CREATE INDEX "TrxWingoBet_periodId_idx" ON "public"."TrxWingoBet"("periodId");

-- CreateIndex
CREATE INDEX "TrxWingoBet_status_idx" ON "public"."TrxWingoBet"("status");

-- CreateIndex
CREATE INDEX "TrxWingoBet_betType_idx" ON "public"."TrxWingoBet"("betType");

-- CreateIndex
CREATE INDEX "TrxWingoBet_createdAt_idx" ON "public"."TrxWingoBet"("createdAt");

-- CreateIndex
CREATE INDEX "TrxWingoBet_userId_periodId_idx" ON "public"."TrxWingoBet"("userId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "TrxWingoBetResult_betId_key" ON "public"."TrxWingoBetResult"("betId");

-- CreateIndex
CREATE INDEX "TrxWingoBetResult_periodId_idx" ON "public"."TrxWingoBetResult"("periodId");

-- CreateIndex
CREATE INDEX "TrxWingoBetResult_isWin_idx" ON "public"."TrxWingoBetResult"("isWin");

-- CreateIndex
CREATE INDEX "TrxWingoBetResult_processedAt_idx" ON "public"."TrxWingoBetResult"("processedAt");

-- AddForeignKey
ALTER TABLE "public"."TrxWingoBet" ADD CONSTRAINT "TrxWingoBet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TrxWingoBet" ADD CONSTRAINT "TrxWingoBet_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "public"."TrxWingoPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TrxWingoBetResult" ADD CONSTRAINT "TrxWingoBetResult_betId_fkey" FOREIGN KEY ("betId") REFERENCES "public"."TrxWingoBet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TrxWingoBetResult" ADD CONSTRAINT "TrxWingoBetResult_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "public"."TrxWingoPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
