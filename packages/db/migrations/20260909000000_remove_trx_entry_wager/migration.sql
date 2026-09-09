-- Remove the withdrawn TRX entry-wager feature and release affected users.
DELETE FROM "WagerRequirement" WHERE "sourceType" = 'TRX_ENTRY';

DROP TABLE IF EXISTS "TrxEntryConsent";
DROP TABLE IF EXISTS "WagerAllocation";

ALTER TABLE "User"
DROP COLUMN IF EXISTS "wagerAccountingInitialized",
DROP COLUMN IF EXISTS "trxVisitId",
DROP COLUMN IF EXISTS "trxVisitRevision";

ALTER TYPE "WagerRequirementType" RENAME TO "WagerRequirementType_old";
CREATE TYPE "WagerRequirementType" AS ENUM ('RECHARGE', 'REWARD');
ALTER TABLE "WagerRequirement"
ALTER COLUMN "sourceType" TYPE "WagerRequirementType"
USING ("sourceType"::text::"WagerRequirementType");
DROP TYPE "WagerRequirementType_old";
