-- CreateTable
CREATE TABLE "IllegalBet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "betAmount" DOUBLE PRECISION NOT NULL,
    "betGame" TEXT NOT NULL,
    "betType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IllegalBet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IllegalBet_userId_idx" ON "IllegalBet"("userId");

-- CreateIndex
CREATE INDEX "IllegalBet_createdAt_idx" ON "IllegalBet"("createdAt");

-- AddForeignKey
ALTER TABLE "IllegalBet" ADD CONSTRAINT "IllegalBet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
