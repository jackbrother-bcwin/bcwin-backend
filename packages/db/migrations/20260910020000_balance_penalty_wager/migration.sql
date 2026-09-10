-- New penalties snapshot wallet×factor into a PENALTY requirement.
-- Existing deposit-multiplied users stay LEGACY_DEPOSIT until their next penalty event.
CREATE TYPE "PenaltyWagerModel" AS ENUM ('LEGACY_DEPOSIT', 'BALANCE_SNAPSHOT');

ALTER TABLE "User"
ADD COLUMN "penaltyWagerModel" "PenaltyWagerModel" NOT NULL DEFAULT 'LEGACY_DEPOSIT';

ALTER TYPE "WagerRequirementType" ADD VALUE 'PENALTY';
