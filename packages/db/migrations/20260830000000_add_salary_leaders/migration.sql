-- CreateTable
CREATE TABLE "SalaryLeader" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryLeader_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalaryLeader_userId_key" ON "SalaryLeader"("userId");

-- CreateIndex
CREATE INDEX "SalaryLeader_createdAt_idx" ON "SalaryLeader"("createdAt");

-- AddForeignKey
ALTER TABLE "SalaryLeader" ADD CONSTRAINT "SalaryLeader_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
