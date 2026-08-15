-- CreateTable
CREATE TABLE "public"."Config" (
    "id" TEXT NOT NULL,
    "upiIds" TEXT[],
    "cxpayEnabled" BOOLEAN NOT NULL DEFAULT false,
    "upiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "serviceFeePercent" DOUBLE PRECISION NOT NULL DEFAULT 2,
    "minDepositAmount" INTEGER NOT NULL DEFAULT 300,
    "minWithdrawAmount" INTEGER NOT NULL DEFAULT 300,
    "minBetForWithdraw" INTEGER NOT NULL DEFAULT 0,
    "maxWithdrawApplicationsPerDay" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Config_pkey" PRIMARY KEY ("id")
);
