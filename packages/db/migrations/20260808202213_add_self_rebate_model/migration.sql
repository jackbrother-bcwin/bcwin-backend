-- CreateTable
CREATE TABLE "SelfRebate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "betAmount" DOUBLE PRECISION NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "game" TEXT NOT NULL,
    "gameCategory" "RebateGameCategory",
    "betId" TEXT,
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "expired" BOOLEAN NOT NULL DEFAULT false,
    "date" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfRebate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SelfRebate_userId_idx" ON "SelfRebate"("userId");

-- CreateIndex
CREATE INDEX "SelfRebate_userId_date_idx" ON "SelfRebate"("userId", "date");

-- CreateIndex
CREATE INDEX "SelfRebate_userId_claimed_expired_idx" ON "SelfRebate"("userId", "claimed", "expired");

-- CreateIndex
CREATE INDEX "SelfRebate_date_idx" ON "SelfRebate"("date");

-- CreateIndex
CREATE INDEX "SelfRebate_claimed_idx" ON "SelfRebate"("claimed");

-- AddForeignKey
ALTER TABLE "SelfRebate" ADD CONSTRAINT "SelfRebate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
