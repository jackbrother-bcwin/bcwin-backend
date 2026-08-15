-- INR minimum deposit: ₹300 → ₹100
-- Does not change minWithdrawAmount.

ALTER TABLE "Config"
  ALTER COLUMN "minDepositAmount" SET DEFAULT 100;

-- Live config row(s) that still use the old floor
UPDATE "Config"
SET "minDepositAmount" = 100
WHERE "minDepositAmount" = 300;
