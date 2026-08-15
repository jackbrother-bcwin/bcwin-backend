-- CreateEnum
CREATE TYPE "GreytopGameType" AS ENUM ('MINI', 'FISHING', 'SLOT', 'RUMMY', 'LIVE_CASINO', 'SPORTS', 'OTHER');

-- CreateTable
CREATE TABLE "GreytopGame" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "type" "GreytopGameType"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GreytopGame_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GreytopGame_name_key" ON "GreytopGame"("name");

-- CreateIndex
CREATE UNIQUE INDEX "GreytopGame_uid_key" ON "GreytopGame"("uid");

-- CreateIndex
CREATE INDEX "GreytopGame_name_idx" ON "GreytopGame"("name");

-- CreateIndex
CREATE INDEX "GreytopGame_uid_idx" ON "GreytopGame"("uid");

-- CreateIndex
CREATE INDEX "GreytopGame_providerName_idx" ON "GreytopGame"("providerName");

-- CreateIndex
CREATE INDEX "GreytopGame_providerCode_idx" ON "GreytopGame"("providerCode");
