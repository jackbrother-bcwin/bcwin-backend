-- CreateTable
CREATE TABLE "SpinWheel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "availableSpins" INTEGER NOT NULL DEFAULT 1,
    "dailyCumulativeDeposit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastResetDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "extraSpinsClaimed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpinWheel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpinWheel_userId_key" ON "SpinWheel"("userId");

-- CreateIndex
CREATE INDEX "SpinWheel_userId_idx" ON "SpinWheel"("userId");

-- CreateIndex
CREATE INDEX "SpinWheel_lastResetDate_idx" ON "SpinWheel"("lastResetDate");

-- AddForeignKey
ALTER TABLE "SpinWheel" ADD CONSTRAINT "SpinWheel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
