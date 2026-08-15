-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "IpActivityType" AS ENUM ('LOGIN', 'REGISTER', 'BETTING', 'DEPOSIT', 'WITHDRAWAL');

-- AlterTable
ALTER TABLE "Ip" ADD COLUMN     "lastActivityAt" TIMESTAMP(3),
ADD COLUMN     "riskLevel" "RiskLevel" NOT NULL DEFAULT 'LOW';

-- CreateTable
CREATE TABLE "IpActivity" (
    "id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "userId" TEXT,
    "activityType" "IpActivityType" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IpActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IpActivity_ip_idx" ON "IpActivity"("ip");

-- CreateIndex
CREATE INDEX "IpActivity_userId_idx" ON "IpActivity"("userId");

-- CreateIndex
CREATE INDEX "IpActivity_activityType_idx" ON "IpActivity"("activityType");

-- CreateIndex
CREATE INDEX "IpActivity_createdAt_idx" ON "IpActivity"("createdAt");

-- CreateIndex
CREATE INDEX "IpActivity_ip_activityType_idx" ON "IpActivity"("ip", "activityType");

-- CreateIndex
CREATE INDEX "IpActivity_ip_createdAt_idx" ON "IpActivity"("ip", "createdAt");

-- CreateIndex
CREATE INDEX "Ip_riskLevel_idx" ON "Ip"("riskLevel");

-- CreateIndex
CREATE INDEX "Ip_lastActivityAt_idx" ON "Ip"("lastActivityAt");

-- AddForeignKey
ALTER TABLE "IpActivity" ADD CONSTRAINT "IpActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
