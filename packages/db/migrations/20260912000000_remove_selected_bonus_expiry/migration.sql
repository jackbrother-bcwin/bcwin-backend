-- Preserve collected/expired history; remove deadlines from outstanding rewards.
UPDATE "ActivityBonus"
SET "expiresAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
WHERE "type" IN ('DAILY', 'INVITATION', 'FIRST_DEPOSIT')
  AND "status" IN ('PENDING', 'COMPLETED_UNCOLLECTED')
  AND "expiresAt" IS NOT NULL;
