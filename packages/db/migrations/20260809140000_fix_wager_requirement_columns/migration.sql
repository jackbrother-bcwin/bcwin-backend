-- Fix prod drift: schema has amount/multiplier/wagerCleared; early WagerRequirement table lacked them.
-- Safe on reset (columns already present from fixed create) and on already-applied incomplete tables.

ALTER TABLE "WagerRequirement" ADD COLUMN IF NOT EXISTS "amount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "WagerRequirement" ADD COLUMN IF NOT EXISTS "multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0;
ALTER TABLE "WagerRequirement" ADD COLUMN IF NOT EXISTS "wagerCleared" DOUBLE PRECISION NOT NULL DEFAULT 0;
