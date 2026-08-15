# 🎲 Wingo Backend Implementation Plan

## Overview
Complete implementation plan for Wingo betting game system following existing bcwin codebase patterns and architecture.

## Architecture Analysis

### Current Codebase Structure
- **Monorepo**: Uses Bun with packages and apps structure
- **API App** (`apps/api`): Hono-based REST API with OpenAPI/Zod validation
- **Engine App** (`apps/engine`): Game logic processing service (currently minimal)
- **Packages**: Shared utilities (db, logger, cache)
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: JWT-based with cookie authentication
- **Code Style**: TypeScript, functional patterns, OpenAPI schemas

### Database Patterns
- UUID primary keys
- Camel case naming
- Created/updated timestamps
- Proper indexing for queries
- Enum types for status fields
- Foreign key relationships with cascade deletes

## Phase 1: Database Schema Implementation

### New Prisma Models (to add to schema.prisma)

```prisma
model WingoPeriod {
    id                String   @id @default(uuid())
    periodNumber      String   @unique
    durationSeconds   Int      // 30, 60, 180, 300
    startTime         DateTime
    endTime           DateTime
    resultNumber      Int?     // 0-9, null until resolved
    resultColor       String?  // RED, GREEN, VIOLET
    resultSize        String?  // BIG, SMALL
    status            WingoPeriodStatus @default(ACTIVE)
    
    wingoBets         WingoBet[]
    wingoBetResults   WingoBetResult[]
    
    createdAt         DateTime @default(now())
    updatedAt         DateTime @updatedAt
    
    @@index([durationSeconds])
    @@index([startTime])
    @@index([status])
    @@index([periodNumber])
}

model WingoBet {
    id                String     @id @default(uuid())
    user              User       @relation(fields: [userId], references: [id], onDelete: Cascade)
    userId            String
    period            WingoPeriod @relation(fields: [periodId], references: [id], onDelete: Cascade)
    periodId          String
    
    betAmount         Float      // Original bet amount
    contractAmount    Float      // After service fee deduction (98%)
    betType           WingoBetType
    betChoice         String     // RED, GREEN, VIOLET, BIG, SMALL, or 0-9
    
    status            WingoBetStatus @default(PENDING)
    
    wingoBetResult    WingoBetResult?
    
    createdAt         DateTime   @default(now())
    updatedAt         DateTime   @updatedAt
    
    @@index([userId])
    @@index([periodId])
    @@index([status])
    @@index([betType])
    @@index([createdAt])
    @@index([userId, periodId])
}

model WingoBetResult {
    id                String     @id @default(uuid())
    bet               WingoBet   @relation(fields: [betId], references: [id], onDelete: Cascade)
    betId             String     @unique
    period            WingoPeriod @relation(fields: [periodId], references: [id], onDelete: Cascade)
    periodId          String
    
    isWin             Boolean
    winAmount         Float      @default(0)
    multiplier        Float?     // Applied multiplier for reference
    processedAt       DateTime   @default(now())
    
    createdAt         DateTime   @default(now())
    updatedAt         DateTime   @updatedAt
    
    @@index([periodId])
    @@index([isWin])
    @@index([processedAt])
}

enum WingoPeriodStatus {
    ACTIVE      // Period running, accepting bets
    ENDED       // Period ended, calculating results
    RESOLVED    // Results calculated and payouts processed
}

enum WingoBetType {
    COLOR       // RED, GREEN, VIOLET
    NUMBER      // 0-9
    SIZE        // BIG, SMALL
}

enum WingoBetStatus {
    PENDING     // Bet placed, period not resolved
    WON         // Bet won, payout processed
    LOST        // Bet lost
}
```

### User Model Updates
Add to existing User model:
```prisma
wingoBets         WingoBet[]
```

## Phase 2: API Routes Implementation

### Route Structure (`apps/api/src/routes/wingo/`)

#### 2.1 Period Routes (`period.ts`)
```typescript
// GET /wingo/periods - Get current/recent periods
// GET /wingo/periods/:duration - Get periods for specific duration
```

#### 2.2 Bet Routes (`bet.ts`)
```typescript
// POST /wingo/bet - Place a bet
// GET /wingo/bets - Get user's bets history
// GET /wingo/bets/:periodId - Get user's bets for specific period
```

#### 2.3 Results Routes (`results.ts`)
```typescript
// GET /wingo/results - Get recent results
// GET /wingo/results/:periodId - Get specific period result
```

### Schema Definitions (`apps/api/src/schemas/wingo.ts`)

```typescript
export const wingoPeriodResponseSchema = z.object({
    id: z.string().uuid(),
    periodNumber: z.string(),
    durationSeconds: z.number(),
    startTime: z.string().datetime(),
    endTime: z.string().datetime(),
    resultNumber: z.number().min(0).max(9).nullable(),
    resultColor: z.enum(["RED", "GREEN", "VIOLET"]).nullable(),
    resultSize: z.enum(["BIG", "SMALL"]).nullable(),
    status: z.enum(["ACTIVE", "ENDED", "RESOLVED"])
});

export const placeBetRequestSchema = z.object({
    periodId: z.string().uuid(),
    betType: z.enum(["COLOR", "NUMBER", "SIZE"]),
    betChoice: z.string(),
    betAmount: z.number().min(1).max(10000)
});

export const wingoBetResponseSchema = z.object({
    id: z.string().uuid(),
    periodId: z.string().uuid(),
    betAmount: z.number(),
    contractAmount: z.number(),
    betType: z.enum(["COLOR", "NUMBER", "SIZE"]),
    betChoice: z.string(),
    status: z.enum(["PENDING", "WON", "LOST"]),
    result: z.object({
        isWin: z.boolean(),
        winAmount: z.number(),
        multiplier: z.number().nullable()
    }).nullable(),
    createdAt: z.string().datetime()
});
```

## Phase 3: Engine Service Implementation

### Core Services (`apps/engine/src/services/`)

#### 3.1 Period Management Service (`periodManager.ts`)
```typescript
class PeriodManager {
    // Auto-create periods for all durations
    async createPeriodsScheduler(): Promise<void>
    
    // End active periods and trigger result calculation
    async endActivePeriods(): Promise<void>
    
    // Get current active period for duration
    async getCurrentPeriod(durationSeconds: number): Promise<WingoPeriod | null>
}
```

#### 3.2 Result Generation Service (`resultGenerator.ts`)
```typescript
class ResultGenerator {
    // Generate random result number (0-9)
    generateResultNumber(): number
    
    // Calculate color based on number
    calculateResultColor(number: number): string
    
    // Calculate size based on number
    calculateResultSize(number: number): string
    
    // Process period result
    async processePeriodResult(periodId: string): Promise<void>
}
```

#### 3.3 Bet Settlement Service (`betSettlement.ts`)
```typescript
class BetSettlement {
    // Calculate contract amount (98% of bet)
    calculateContractAmount(betAmount: number): number
    
    // Calculate win amount based on bet type and result
    calculateWinAmount(bet: WingoBet, result: PeriodResult): number
    
    // Process all bets for a period
    async settlePeriodBets(periodId: string): Promise<void>
    
    // Update user balance and create ledger entry
    async processWinnings(betId: string, winAmount: number): Promise<void>
}
```

#### 3.4 Game Logic Service (`gameLogic.ts`)
```typescript
class GameLogic {
    // Validate bet choice for bet type
    validateBetChoice(betType: string, betChoice: string): boolean
    
    // Check if bet wins based on result
    checkBetWin(bet: WingoBet, result: PeriodResult): boolean
    
    // Get multiplier for winning bet
    getWinMultiplier(bet: WingoBet, result: PeriodResult): number
}
```

### Scheduler Implementation (`apps/engine/src/scheduler.ts`)
```typescript
// Cron jobs for different game durations:
// - Every 30s: 30-second games
// - Every 1m: 1-minute games  
// - Every 3m: 3-minute games
// - Every 5m: 5-minute games
```

## Phase 4: API Implementation Details

### 4.1 Place Bet Endpoint
**Route**: `POST /wingo/bet`

**Logic Flow**:
1. Validate user authentication
2. Validate bet request (amount, choice, type)
3. Check if period is still active
4. Check user balance sufficient
5. Calculate contract amount (98%)
6. Create WingoBet record
7. Update user balance (deduct bet amount)
8. Return bet confirmation

### 4.2 Get Periods Endpoint
**Route**: `GET /wingo/periods?duration=60`

**Logic Flow**:
1. Fetch active/recent periods for duration
2. Include current period status
3. Return periods with time remaining

### 4.3 Get Results Endpoint
**Route**: `GET /wingo/results?duration=60&limit=20`

**Logic Flow**:
1. Fetch resolved periods
2. Include result details (number, color, size)
3. Optionally include user's bet results

## Phase 5: Business Logic Implementation

### 5.1 Betting Rules Validation
```typescript
// Color bets: RED, GREEN, VIOLET
// Number bets: 0-9
// Size bets: BIG (5-9), SMALL (0-4)
// Special cases for 0 and 5 (VIOLET combinations)
```

### 5.2 Payout Calculations
```typescript
const MULTIPLIERS = {
    COLOR_NORMAL: 2.0,      // RED/GREEN normal win
    COLOR_SPECIAL: 1.5,     // RED with 0, GREEN with 5
    VIOLET: 4.5,            // VIOLET with 0 or 5
    NUMBER: 9.0,            // Exact number match
    SIZE: 2.0               // BIG/SMALL (except 0/5)
};
```

### 5.3 Service Fee Handling
```typescript
const SERVICE_FEE_PERCENT = 2; // 2%
const contractAmount = betAmount * (100 - SERVICE_FEE_PERCENT) / 100;
```

## Phase 6: Error Handling & Validation

### 6.1 Bet Validation
- Period must be ACTIVE
- User must have sufficient balance
- Bet choice must be valid for bet type
- Amount within min/max limits

### 6.2 Settlement Safeguards
- Idempotent processing (prevent double payouts)
- Atomic transactions
- Balance validation
- Result integrity checks

## Phase 7: Database Indexes & Performance

### 7.1 Critical Indexes
```sql
-- Query current periods
CREATE INDEX idx_wingo_period_duration_status ON "WingoPeriod" ("durationSeconds", "status");

-- User bet history
CREATE INDEX idx_wingo_bet_user_created ON "WingoBet" ("userId", "createdAt" DESC);

-- Period settlement queries  
CREATE INDEX idx_wingo_bet_period_status ON "WingoBet" ("periodId", "status");
```

## Phase 8: Implementation Order

1. **Database Schema** - Add Prisma models and run migration
2. **Basic API Routes** - Period fetching, bet placement validation
3. **Engine Core Services** - Period creation, result generation
4. **Settlement Logic** - Bet evaluation and payout processing
5. **Scheduler Integration** - Automated period management
6. **API Completion** - Full endpoint implementation
7. **Error Handling** - Comprehensive validation and error responses
8. **Testing** - Unit tests and integration tests
9. **Performance Optimization** - Caching, indexes, query optimization

## Phase 9: File Structure

```
apps/
├── api/src/routes/wingo/
│   ├── index.ts          # Route registration
│   ├── periods.ts        # Period management routes
│   ├── bets.ts           # Betting routes  
│   └── results.ts        # Results and history routes
├── api/src/schemas/
│   └── wingo.ts          # Wingo-specific schemas
└── engine/src/
    ├── services/wingo/
    │   ├── periodManager.ts
    │   ├── resultGenerator.ts
    │   ├── betSettlement.ts
    │   └── gameLogic.ts
    ├── scheduler/
    │   └── wingoScheduler.ts
    └── index.ts          # Engine main with scheduler
```

## Notes
- Follow existing codebase patterns (Hono routes, OpenAPI schemas, Prisma conventions)
- Maintain consistency with current error handling and response formats
- Use existing logger and database connection patterns
- Implement proper TypeScript types throughout
- Follow existing authentication and authorization patterns