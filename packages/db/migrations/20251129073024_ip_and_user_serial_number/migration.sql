/*
  Warnings:

  - A unique constraint covering the columns `[serialNumber]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "serialNumber" SERIAL NOT NULL;

-- CreateTable
CREATE TABLE "IP" (
    "id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IP_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IP_ip_key" ON "IP"("ip");

-- CreateIndex
CREATE INDEX "IP_ip_idx" ON "IP"("ip");

-- CreateIndex
CREATE UNIQUE INDEX "User_serialNumber_key" ON "User"("serialNumber");
