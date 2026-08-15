-- AlterTable
ALTER TABLE "Config" ADD COLUMN     "maintananceMessage" TEXT,
ADD COLUMN     "maintananceMode" BOOLEAN NOT NULL DEFAULT false;
