-- AlterTable
ALTER TABLE "User" ALTER COLUMN "serialNumber" DROP DEFAULT;
DROP SEQUENCE "User_serialNumber_seq";
