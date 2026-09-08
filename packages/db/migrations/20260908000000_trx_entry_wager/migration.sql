ALTER TYPE "WagerRequirementType" ADD VALUE 'TRX_ENTRY';

ALTER TABLE "User"
ADD COLUMN "wagerAccountingInitialized" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "trxVisitId" TEXT,
ADD COLUMN "trxVisitRevision" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "WagerAllocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "requirementId" TEXT NOT NULL REFERENCES "WagerRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "betKey" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL
);
CREATE UNIQUE INDEX "WagerAllocation_requirementId_betKey_key" ON "WagerAllocation"("requirementId", "betKey");
CREATE INDEX "WagerAllocation_userId_betKey_idx" ON "WagerAllocation"("userId", "betKey");

CREATE TABLE "TrxEntryConsent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "balance" DOUBLE PRECISION NOT NULL,
    "multiplier" DOUBLE PRECISION NOT NULL,
    "remainingBefore" DOUBLE PRECISION NOT NULL,
    "remainingAfter" DOUBLE PRECISION NOT NULL,
    "addedWager" DOUBLE PRECISION NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3)
);
CREATE INDEX "TrxEntryConsent_userId_acceptedAt_idx" ON "TrxEntryConsent"("userId", "acceptedAt");
