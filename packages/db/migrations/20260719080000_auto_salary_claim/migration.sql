-- CreateEnum
CREATE TYPE "AutoSalaryClaimStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "AutoSalaryClaim" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodDate" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "slabIndex" INTEGER NOT NULL,
    "directCount" INTEGER NOT NULL,
    "activeCount" INTEGER NOT NULL,
    "teamDeposit" DOUBLE PRECISION NOT NULL,
    "status" "AutoSalaryClaimStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoSalaryClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutoSalaryClaim_status_periodDate_idx" ON "AutoSalaryClaim"("status", "periodDate");

-- CreateIndex
CREATE INDEX "AutoSalaryClaim_periodDate_idx" ON "AutoSalaryClaim"("periodDate");

-- CreateIndex
CREATE INDEX "AutoSalaryClaim_userId_idx" ON "AutoSalaryClaim"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AutoSalaryClaim_userId_periodDate_key" ON "AutoSalaryClaim"("userId", "periodDate");

-- AddForeignKey
ALTER TABLE "AutoSalaryClaim" ADD CONSTRAINT "AutoSalaryClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoSalaryClaim" ADD CONSTRAINT "AutoSalaryClaim_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
