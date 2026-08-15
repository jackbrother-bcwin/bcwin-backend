-- AlterTable
ALTER TABLE "Config" ADD COLUMN     "illegalBetPenaltyFactor" DOUBLE PRECISION NOT NULL DEFAULT 3.0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "hasIllegalBetPenalty" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "illegalBetPenaltyFactor" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "User_hasIllegalBetPenalty_idx" ON "User"("hasIllegalBetPenalty");
