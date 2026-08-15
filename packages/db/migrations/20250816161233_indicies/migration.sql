-- CreateIndex
CREATE INDEX "Deposit_userId_idx" ON "public"."Deposit"("userId");

-- CreateIndex
CREATE INDEX "Deposit_status_idx" ON "public"."Deposit"("status");

-- CreateIndex
CREATE INDEX "Deposit_createdAt_idx" ON "public"."Deposit"("createdAt");

-- CreateIndex
CREATE INDEX "Deposit_userId_status_idx" ON "public"."Deposit"("userId", "status");

-- CreateIndex
CREATE INDEX "Gift_exaushted_idx" ON "public"."Gift"("exaushted");

-- CreateIndex
CREATE INDEX "GiftRedemption_giftId_idx" ON "public"."GiftRedemption"("giftId");

-- CreateIndex
CREATE INDEX "User_referredBy_idx" ON "public"."User"("referredBy");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "public"."User"("role");

-- CreateIndex
CREATE INDEX "User_isBanned_idx" ON "public"."User"("isBanned");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "public"."User"("createdAt");

-- CreateIndex
CREATE INDEX "Withdraw_userId_idx" ON "public"."Withdraw"("userId");

-- CreateIndex
CREATE INDEX "Withdraw_status_idx" ON "public"."Withdraw"("status");

-- CreateIndex
CREATE INDEX "Withdraw_createdAt_idx" ON "public"."Withdraw"("createdAt");

-- CreateIndex
CREATE INDEX "Withdraw_userId_status_idx" ON "public"."Withdraw"("userId", "status");
