-- CreateEnum
CREATE TYPE "QueryType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'BANK_CHANGE', 'BONUS');

-- CreateEnum
CREATE TYPE "QueryStatus" AS ENUM ('CREATED', 'VERIFIED', 'PROCESSING', 'COMPLETED', 'REJECTED');

-- CreateTable
CREATE TABLE "UserQuery" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "QueryType" NOT NULL,
    "status" "QueryStatus" NOT NULL DEFAULT 'CREATED',
    "subject" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "adminNotes" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserQuery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserQuery_ticketId_key" ON "UserQuery"("ticketId");

-- CreateIndex
CREATE INDEX "UserQuery_userId_idx" ON "UserQuery"("userId");

-- CreateIndex
CREATE INDEX "UserQuery_status_idx" ON "UserQuery"("status");

-- CreateIndex
CREATE INDEX "UserQuery_type_idx" ON "UserQuery"("type");

-- CreateIndex
CREATE INDEX "UserQuery_userId_status_idx" ON "UserQuery"("userId", "status");

-- CreateIndex
CREATE INDEX "UserQuery_createdAt_idx" ON "UserQuery"("createdAt");

-- AddForeignKey
ALTER TABLE "UserQuery" ADD CONSTRAINT "UserQuery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
