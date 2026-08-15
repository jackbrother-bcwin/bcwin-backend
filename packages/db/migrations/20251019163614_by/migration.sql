/*
  Warnings:

  - Added the required column `byUserId` to the `AdminBalanceUpdateTransaction` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."AdminBalanceUpdateTransaction" ADD COLUMN     "byUserId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "public"."AdminBalanceUpdateTransaction" ADD CONSTRAINT "AdminBalanceUpdateTransaction_byUserId_fkey" FOREIGN KEY ("byUserId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
