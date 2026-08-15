-- CreateEnum
CREATE TYPE "WingoAlgorithm" AS ENUM ('RANDOM', 'WINNING');

-- AlterTable
ALTER TABLE "Config" ADD COLUMN     "wingoAlgorithm" "WingoAlgorithm" NOT NULL DEFAULT 'RANDOM';
