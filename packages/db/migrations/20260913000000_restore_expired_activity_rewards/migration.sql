-- Restore the three reward types whose deadlines were removed.
-- Preserve original reward IDs, amounts and milestones; users must still claim.
-- Skip any row with evidence that it was already paid.
UPDATE "ActivityBonus" AS bonus
SET "status" = 'COMPLETED_UNCOLLECTED',
    "expiresAt" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE bonus."type" IN ('DAILY', 'INVITATION', 'FIRST_DEPOSIT')
  AND bonus."status" = 'EXPIRED'
  AND bonus."claimAt" IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM "WagerRequirement" AS wager
      WHERE wager."userId" = bonus."userId"
        AND wager."sourceType" = 'REWARD'
        AND wager."sourceId" = bonus."id"
  );
