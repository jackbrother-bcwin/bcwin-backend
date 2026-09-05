-- No explicit transaction: concurrent builds keep bet/payment writes available.
-- If interrupted, inspect/drop only the invalid index before retrying the migration.
CREATE INDEX CONCURRENTLY "User_role_isDemo_balance_serialNumber_idx" ON "User" ("role", "isDemo", "balance" DESC, "serialNumber");
CREATE INDEX CONCURRENTLY "InoutBet_createdAt_idx" ON "InoutBet" ("createdAt");
CREATE INDEX CONCURRENTLY "InoutBet_userId_createdAt_idx" ON "InoutBet" ("userId", "createdAt");
CREATE INDEX CONCURRENTLY "WingoBet_userId_createdAt_idx" ON "WingoBet" ("userId", "createdAt");
CREATE INDEX CONCURRENTLY "FiveDBet_userId_createdAt_idx" ON "FiveDBet" ("userId", "createdAt");
CREATE INDEX CONCURRENTLY "K3Bet_userId_createdAt_idx" ON "K3Bet" ("userId", "createdAt");
CREATE INDEX CONCURRENTLY "MotoBet_userId_createdAt_idx" ON "MotoBet" ("userId", "createdAt");
CREATE INDEX CONCURRENTLY "TrxWingoBet_userId_createdAt_idx" ON "TrxWingoBet" ("userId", "createdAt");
CREATE INDEX CONCURRENTLY "Deposit_userId_status_createdAt_idx" ON "Deposit" ("userId", "status", "createdAt");
CREATE INDEX CONCURRENTLY "Withdraw_userId_status_createdAt_idx" ON "Withdraw" ("userId", "status", "createdAt");
