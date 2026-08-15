-- AlterEnum
ALTER TYPE "ActivityBonusType" ADD VALUE 'WIN_STREAK';

-- CreateTable
CREATE TABLE "WinStreakRule" (
    "id" TEXT NOT NULL,
    "consecutiveWins" INTEGER NOT NULL,
    "bonusPercentage" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WinStreakRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserWinStreak" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "streakWinAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastBetGame" TEXT,
    "lastBetAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserWinStreak_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WinStreakRule_consecutiveWins_key" ON "WinStreakRule"("consecutiveWins");

-- CreateIndex
CREATE INDEX "WinStreakRule_consecutiveWins_idx" ON "WinStreakRule"("consecutiveWins");

-- CreateIndex
CREATE INDEX "WinStreakRule_isActive_idx" ON "WinStreakRule"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "UserWinStreak_userId_key" ON "UserWinStreak"("userId");

-- AddForeignKey
ALTER TABLE "UserWinStreak" ADD CONSTRAINT "UserWinStreak_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
