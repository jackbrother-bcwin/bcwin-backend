ALTER TABLE "IllegalBet" ADD COLUMN "penaltyEventKey" TEXT;
CREATE UNIQUE INDEX "IllegalBet_penaltyEventKey_key" ON "IllegalBet"("penaltyEventKey");
