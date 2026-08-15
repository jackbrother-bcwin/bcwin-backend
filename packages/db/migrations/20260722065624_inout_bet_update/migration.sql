/*
  Warnings:

  - A unique constraint covering the columns `[transactionId]` on the table `InoutBet` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "InoutBet_transactionId_key" ON "InoutBet"("transactionId");
