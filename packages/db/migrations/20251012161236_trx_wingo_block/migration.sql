-- AlterTable
ALTER TABLE "public"."TrxWingoPeriod" ADD COLUMN     "blockHash" TEXT,
ADD COLUMN     "blockNumber" INTEGER,
ADD COLUMN     "blockTimestamp" TIMESTAMP(3);
