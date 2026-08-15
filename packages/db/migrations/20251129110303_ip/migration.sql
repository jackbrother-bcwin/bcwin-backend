/*
  Warnings:

  - You are about to drop the `IP` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "IP";

-- CreateTable
CREATE TABLE "Ip" (
    "id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Ip_ip_key" ON "Ip"("ip");

-- CreateIndex
CREATE INDEX "Ip_ip_idx" ON "Ip"("ip");
