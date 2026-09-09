-- Audit permanent admin wager clear actions. Legacy zero-wager columns remain
-- temporarily so this release is compatible with containers from the prior build.
CREATE TABLE "WagerClearEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clearedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "previousPenaltyFactor" DOUBLE PRECISION,
    "baseWagerFactor" DOUBLE PRECISION NOT NULL,
    "beforeDepositWagerNeeded" DOUBLE PRECISION NOT NULL,
    "beforeRewardWagerNeeded" DOUBLE PRECISION NOT NULL,
    "afterDepositWagerNeeded" DOUBLE PRECISION NOT NULL,
    "afterRewardWagerNeeded" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WagerClearEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WagerClearEvent_userId_createdAt_idx"
ON "WagerClearEvent"("userId", "createdAt");

CREATE INDEX "WagerClearEvent_clearedById_createdAt_idx"
ON "WagerClearEvent"("clearedById", "createdAt");

ALTER TABLE "WagerClearEvent"
ADD CONSTRAINT "WagerClearEvent_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WagerClearEvent"
ADD CONSTRAINT "WagerClearEvent_clearedById_fkey"
FOREIGN KEY ("clearedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
