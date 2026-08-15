# Activity Bonus Implementation Plan

## Overview

Implement activity bonus system with automatic progress tracking, manual claiming, and expiration handling across 5 bonus types.

## 1. Schema Updates

### Update `packages/db/schema.prisma`:

- Add `lastLoginDate` and `loginStreak` fields to User model for attendance tracking
- Ensure ActivityBonus model has proper indexes and metadata field for storing tier information
```prisma
model User {
  lastLoginDate DateTime?
  loginStreak   Int @default(0)
  // ... existing fields
}

model ActivityBonus {
  metadata Json? // Store tier info, requirements, etc.
  expiresAt DateTime?
  // ... existing fields
}
```


## 2. Core Library: `apps/api/src/lib/activityBonus.ts`

Create comprehensive activity bonus logic module with:

### Configuration Constants

- `WEEKLY_TIERS`: 6 tiers (10k→25, 20k→50, 50k→200, 100k→500, 150k→700, 300k→1500)
- `DAILY_TIERS`: 5 tiers with deposit + bet requirements
- `INVITATION_TIERS`: 12 tiers from 1 invite to 5000 invites
- `FIRST_DEPOSIT_TIERS`: 5 tiers (100→18, 300→28, 500→108, 1000→188, 5000→488)
- `ATTENDANCE_TIERS`: 7 days with accumulated deposit requirements
- Expiration rules: Daily/Attendance = 1 day, others = 7 days

### Core Functions

**Weekly Bonus:**

- `checkAndCreateWeeklyBonuses(userId: string)`: Use `getTotalUserSlotBets()` from utils.ts for 7-day rolling window, check completed tiers, create COMPLETED_UNCOLLECTED bonuses for new achievements

**Daily Bonus:**

- `checkAndCreateDailyBonuses(userId: string)`: Calculate today's deposits and bets, check both conditions met, create bonuses for completed tiers

**Invitation Bonus:**

- `checkAndCreateInvitationBonuses(userId: string)`: Count referred users meeting deposit requirements per tier, create bonuses for completed tiers
- **Scheduled to run daily at 1:00 AM for all users**

**First Deposit:**

- `checkAndCreateFirstDepositBonus(userId: string, depositAmount: number)`: On first-ever deposit, create bonus for highest qualifying tier

**Attendance:**

- `updateLoginStreak(userId: string)`: Update streak on login (increment if yesterday, reset to 1 if missed)
- `checkAndCreateAttendanceBonus(userId: string)`: If eligible based on streak day + accumulated deposits, create bonus

**Expiration:**

- `expireOldBonuses()`: Background job to mark COMPLETED_UNCOLLECTED bonuses as EXPIRED based on type-specific rules

**Utilities:**

- Use existing `getTotalUserSlotBets(userId)` from `apps/api/src/lib/utils.ts` with date filtering
- `getUserTotalDeposits(userId, startDate?, endDate?)`: Sum successful deposits
- `getUserInvitedUsersWithDeposits(userId, minDeposit)`: Count referred users with deposit >= threshold

### Performance Pattern

Use **fire-and-forget** (no await) for bonus check functions where appropriate:

- Login flow: Don't await attendance/streak updates
- Bet placement: Don't await weekly/daily checks
- Deposit callbacks: Don't await first deposit/daily checks
- Only await when response depends on result

## 3. API Endpoints

### User Routes: `apps/api/src/routes/user/activity/`

**GET `/user/activity/progress`**

Returns current progress across all bonus types with tier completion status:

```typescript
{
  weekly: [{ requirement: 10000, current: 52300, reward: 25, completed: true, claimed: true }],
  daily: [...],
  invitation: { tiers: [...], invitedUsers: [...] },
  firstDeposit: { ... },
  attendance: { currentStreak: 3, eligible: true, ... }
}
```

**GET `/user/activity/bonuses`**

List user's activity bonuses with pagination, filters (type, status)

**POST `/user/activity/claim/:bonusId`**

Claim a COMPLETED_UNCOLLECTED bonus:

- Verify not expired
- Add amount to user balance
- Update status to COLLECTED
- Set claimAt timestamp

**GET `/user/activity/history`**

Historical activity bonus claims with pagination

## 4. Integration Points

### Login (`apps/api/src/routes/auth.ts`)

After successful login (line ~362) - **fire-and-forget for performance**:

```typescript
updateLoginStreak(user.id); // no await
checkAndCreateAttendanceBonus(user.id); // no await
```

### Deposit Callback (`apps/api/src/routes/callback/payment/cxpay.ts`)

After successful deposit processing - **fire-and-forget for performance**:

```typescript
checkAndCreateFirstDepositBonus(userId, depositAmount); // no await
checkAndCreateDailyBonuses(userId); // no await
```

### Bet Placement

After each bet is placed (Wingo, 5D, K3, Moto, TrxWingo, Inout) - **fire-and-forget for performance**:

```typescript
checkAndCreateWeeklyBonuses(userId); // no await
checkAndCreateDailyBonuses(userId); // no await
```

### Background Job

Create scheduled tasks (similar to existing rebate/commission jobs):

- Run `expireOldBonuses()` every hour
- Run `checkAndCreateInvitationBonuses()` **daily at 1:00 AM** for all users

## 5. Key Implementation Details

### Date Handling

- Weekly: Rolling 7 days from current date
- Daily: UTC day boundaries (00:00:00 - 23:59:59)
- Attendance: Track consecutive calendar days

### Preventing Duplicates

- Check existing bonuses before creation
- Use metadata JSON field to store tier identifier
- Query by userId + type + metadata to prevent duplicate tier bonuses

### Metadata Structure

```json
{
  "tier": 2,
  "requirement": { "deposit": 1000, "bet": 3000 },
  "userProgress": { "deposit": 1200, "bet": 3500 }
}
```

### Performance

- Cache user totals for deposit/bet calculations
- Batch database queries where possible
- Use existing helper functions from `apps/api/src/lib/utils.ts` (getTotalUserBets, etc.)

## Files to Create

1. `apps/api/src/lib/activityBonus.ts` - Core logic
2. `apps/api/src/routes/user/activity/progress.ts` - Progress endpoint
3. `apps/api/src/routes/user/activity/bonuses.ts` - List bonuses
4. `apps/api/src/routes/user/activity/claim.ts` - Claim endpoint
5. `apps/api/src/routes/user/activity/history.ts` - History endpoint
6. `apps/api/src/routes/user/activity/index.ts` - Route registration
7. `apps/api/src/schemas/activity.ts` - Zod schemas

## Files to Modify

1. `packages/db/schema.prisma` - Add User fields, ActivityBonus metadata
2. `apps/api/src/routes/user/index.ts` - Register activity routes
3. `apps/api/src/routes/auth.ts` - Call attendance functions on login
4. `apps/api/src/routes/callback/payment/cxpay.ts` - Call first deposit/daily checks
5. Bet placement files - Call weekly/daily bonus checks
6. Background job scheduler - Add expiration task