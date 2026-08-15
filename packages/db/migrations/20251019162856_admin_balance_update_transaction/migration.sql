-- CreateTable
CREATE TABLE "public"."AdminBalanceUpdateTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminBalanceUpdateTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminBalanceUpdateTransaction_userId_idx" ON "public"."AdminBalanceUpdateTransaction"("userId");

-- CreateIndex
CREATE INDEX "AdminBalanceUpdateTransaction_createdAt_idx" ON "public"."AdminBalanceUpdateTransaction"("createdAt");

-- AddForeignKey
ALTER TABLE "public"."AdminBalanceUpdateTransaction" ADD CONSTRAINT "AdminBalanceUpdateTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
