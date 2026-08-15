-- CreateTable
CREATE TABLE "Rebate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "game" TEXT NOT NULL,
    "settled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rebate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Rebate_userId_idx" ON "Rebate"("userId");

-- CreateIndex
CREATE INDEX "Rebate_settled_idx" ON "Rebate"("settled");

-- AddForeignKey
ALTER TABLE "Rebate" ADD CONSTRAINT "Rebate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
