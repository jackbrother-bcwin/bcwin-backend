-- Preserve relief already granted through the retired one-use switch. Existing
-- enabled users receive the new permanent clear semantics at deployment.
UPDATE "WagerRequirement" AS requirement
SET "isCleared" = true,
    "wagerCleared" = requirement."requiredWager",
    "updatedAt" = NOW()
WHERE requirement."userId" IN (
    SELECT "id" FROM "User" WHERE "zeroWagerEnabled" = true
)
  AND requirement."sourceType" = 'REWARD'
  AND requirement."isCleared" = false;

WITH base AS (
    SELECT CASE
        WHEN COALESCE((SELECT "wager" FROM "Config" LIMIT 1), 1) > 0
        THEN COALESCE((SELECT "wager" FROM "Config" LIMIT 1), 1)
        ELSE 1
    END AS factor
)
UPDATE "WagerRequirement" AS requirement
SET "multiplier" = base.factor,
    "requiredWager" = CEIL(requirement."amount" * base.factor),
    "updatedAt" = NOW()
FROM base
WHERE requirement."userId" IN (
    SELECT "id" FROM "User" WHERE "zeroWagerEnabled" = true
)
  AND requirement."sourceType" = 'RECHARGE';

UPDATE "User" AS account
SET "hasIllegalBetPenalty" = false,
    "illegalBetPenaltyFactor" = NULL,
    "zeroWagerEnabled" = false,
    "zeroWagerConsumedAt" = NULL,
    "updatedAt" = NOW()
WHERE account."zeroWagerEnabled" = true;
