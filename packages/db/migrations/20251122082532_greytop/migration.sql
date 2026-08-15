-- CreateTable
CREATE TABLE "GreytopBet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "gameUid" TEXT NOT NULL,
    "memberAccount" TEXT NOT NULL,
    "winAmount" TEXT NOT NULL,
    "betAmount" TEXT NOT NULL,
    "timestamp" TEXT NOT NULL,
    "gameRound" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GreytopBet_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "GreytopBet" ADD CONSTRAINT "GreytopBet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
