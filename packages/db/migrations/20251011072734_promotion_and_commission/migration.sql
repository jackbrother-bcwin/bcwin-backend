-- CreateTable
CREATE TABLE "public"."UserVipLevel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currentLevel" INTEGER NOT NULL DEFAULT 0,
    "teamSize" INTEGER NOT NULL DEFAULT 0,
    "teamBetting" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "teamDeposit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastCalculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserVipLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Commission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "layer" INTEGER NOT NULL,
    "userVipLevel" INTEGER NOT NULL,
    "commissionRate" DOUBLE PRECISION NOT NULL,
    "betAmount" DOUBLE PRECISION NOT NULL,
    "commissionAmount" DOUBLE PRECISION NOT NULL,
    "betType" TEXT NOT NULL,
    "betId" TEXT NOT NULL,
    "calculationDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DailyCommissionSummary" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "totalCommission" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "layer1Commission" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "layer2Commission" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "layer3Commission" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "layer4Commission" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "layer5Commission" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "layer6Commission" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyCommissionSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TeamMetrics" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "directTeamSize" INTEGER NOT NULL DEFAULT 0,
    "directTeamBetting" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "directTeamDeposit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalTeamSize" INTEGER NOT NULL DEFAULT 0,
    "totalTeamBetting" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalTeamDeposit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CommissionRateConfig" (
    "id" TEXT NOT NULL,
    "vipLevel" INTEGER NOT NULL,
    "layer1" DOUBLE PRECISION NOT NULL,
    "layer2" DOUBLE PRECISION NOT NULL,
    "layer3" DOUBLE PRECISION NOT NULL,
    "layer4" DOUBLE PRECISION NOT NULL,
    "layer5" DOUBLE PRECISION NOT NULL,
    "layer6" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionRateConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."VipLevelRequirement" (
    "id" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "teamSize" INTEGER NOT NULL,
    "teamBetting" DOUBLE PRECISION NOT NULL,
    "teamDeposit" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VipLevelRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserVipLevel_userId_key" ON "public"."UserVipLevel"("userId");

-- CreateIndex
CREATE INDEX "UserVipLevel_currentLevel_idx" ON "public"."UserVipLevel"("currentLevel");

-- CreateIndex
CREATE INDEX "UserVipLevel_lastCalculatedAt_idx" ON "public"."UserVipLevel"("lastCalculatedAt");

-- CreateIndex
CREATE INDEX "Commission_userId_idx" ON "public"."Commission"("userId");

-- CreateIndex
CREATE INDEX "Commission_fromUserId_idx" ON "public"."Commission"("fromUserId");

-- CreateIndex
CREATE INDEX "Commission_layer_idx" ON "public"."Commission"("layer");

-- CreateIndex
CREATE INDEX "Commission_calculationDate_idx" ON "public"."Commission"("calculationDate");

-- CreateIndex
CREATE INDEX "Commission_betType_idx" ON "public"."Commission"("betType");

-- CreateIndex
CREATE INDEX "Commission_userId_calculationDate_idx" ON "public"."Commission"("userId", "calculationDate");

-- CreateIndex
CREATE INDEX "Commission_fromUserId_calculationDate_idx" ON "public"."Commission"("fromUserId", "calculationDate");

-- CreateIndex
CREATE INDEX "DailyCommissionSummary_date_idx" ON "public"."DailyCommissionSummary"("date");

-- CreateIndex
CREATE INDEX "DailyCommissionSummary_userId_idx" ON "public"."DailyCommissionSummary"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyCommissionSummary_userId_date_key" ON "public"."DailyCommissionSummary"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMetrics_userId_key" ON "public"."TeamMetrics"("userId");

-- CreateIndex
CREATE INDEX "TeamMetrics_totalTeamSize_idx" ON "public"."TeamMetrics"("totalTeamSize");

-- CreateIndex
CREATE INDEX "TeamMetrics_totalTeamBetting_idx" ON "public"."TeamMetrics"("totalTeamBetting");

-- CreateIndex
CREATE INDEX "TeamMetrics_totalTeamDeposit_idx" ON "public"."TeamMetrics"("totalTeamDeposit");

-- CreateIndex
CREATE INDEX "TeamMetrics_lastUpdated_idx" ON "public"."TeamMetrics"("lastUpdated");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionRateConfig_vipLevel_key" ON "public"."CommissionRateConfig"("vipLevel");

-- CreateIndex
CREATE INDEX "CommissionRateConfig_vipLevel_idx" ON "public"."CommissionRateConfig"("vipLevel");

-- CreateIndex
CREATE UNIQUE INDEX "VipLevelRequirement_level_key" ON "public"."VipLevelRequirement"("level");

-- CreateIndex
CREATE INDEX "VipLevelRequirement_level_idx" ON "public"."VipLevelRequirement"("level");

-- AddForeignKey
ALTER TABLE "public"."UserVipLevel" ADD CONSTRAINT "UserVipLevel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Commission" ADD CONSTRAINT "Commission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Commission" ADD CONSTRAINT "Commission_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DailyCommissionSummary" ADD CONSTRAINT "DailyCommissionSummary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TeamMetrics" ADD CONSTRAINT "TeamMetrics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
