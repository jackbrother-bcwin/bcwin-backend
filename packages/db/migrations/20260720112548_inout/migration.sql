/*
  Warnings:

  - You are about to drop the `GreytopBet` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `GreytopGame` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "GreytopBet" DROP CONSTRAINT "GreytopBet_userId_fkey";

-- DropTable
DROP TABLE "GreytopBet";

-- DropTable
DROP TABLE "GreytopGame";

-- DropEnum
DROP TYPE "GreytopGameType";

-- CreateTable
CREATE TABLE "InoutGame" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "gameMode" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "multiplayer" BOOLEAN NOT NULL,
    "rtp" DOUBLE PRECISION NOT NULL,
    "bonusTypes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InoutGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InoutBet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "gameMode" TEXT NOT NULL,
    "betAmount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InoutBet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InoutGame_gameMode_key" ON "InoutGame"("gameMode");

-- CreateIndex
CREATE INDEX "InoutGame_title_idx" ON "InoutGame"("title");

-- CreateIndex
CREATE INDEX "InoutGame_gameMode_idx" ON "InoutGame"("gameMode");

-- CreateIndex
CREATE INDEX "InoutGame_category_idx" ON "InoutGame"("category");

-- AddForeignKey
ALTER TABLE "InoutBet" ADD CONSTRAINT "InoutBet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
