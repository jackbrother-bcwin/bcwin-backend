/*
  Warnings:

  - A unique constraint covering the columns `[email]` on the table `Otp` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[email]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Otp" ADD COLUMN     "email" TEXT,
ALTER COLUMN "mobileNumber" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "email" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Otp_email_key" ON "Otp"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
