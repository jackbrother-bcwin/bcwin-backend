CREATE TABLE "PenaltyHistoryEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventKey" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "game" TEXT,
    "periodNumber" TEXT,
    "evidence" JSONB,
    "previousFactor" DOUBLE PRECISION NOT NULL,
    "resultingFactor" DOUBLE PRECISION NOT NULL,
    "beforeNeedToBet" DOUBLE PRECISION NOT NULL,
    "afterNeedToBet" DOUBLE PRECISION NOT NULL,
    "beforePenaltyWager" DOUBLE PRECISION NOT NULL,
    "afterPenaltyWager" DOUBLE PRECISION NOT NULL,
    "beforeRewardWager" DOUBLE PRECISION NOT NULL,
    "afterRewardWager" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PenaltyHistoryEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PenaltyHistoryEvent_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PenaltyHistoryEvent_eventKey_key" ON "PenaltyHistoryEvent"("eventKey");
CREATE INDEX "PenaltyHistoryEvent_userId_createdAt_id_idx" ON "PenaltyHistoryEvent"("userId", "createdAt", "id");
