# 🏁 Moto Racing Backend Implementation Plan

## Overview
Complete implementation plan for Moto Racing betting game system following existing bcwin codebase patterns and architecture.

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
model MotoPeriod {
    id                String   @id @default(uuid())
    periodNumber      String   @unique
    durationSeconds   Int      // 30, 60, 180, 300
    startTime         DateTime
    endTime           DateTime
    firstPlace        Int?     // 1-10, null until resolved
    secondPlace       Int?     // 1-10, null until resolved
    thirdPlace        Int?     // 1-10, null until resolved
    status            MotoPeriodStatus @default(ACTIVE)
    
    motoBets          MotoBet[]
    motoBetResults    MotoBetResult[]
    
    createdAt         DateTime @default(now())
    updatedAt         DateTime @updatedAt
    
    @@index([durationSeconds])
    @@index([startTime])
    @@index([status])
    @@index([periodNumber])
}

model MotoBet {
    id                String     @id @default(uuid())
    user              User       @relation(fields: [userId], references: [id], onDelete: Cascade)
    userId            String
    period            MotoPeriod @relation(fields: [periodId], references: [id], onDelete: Cascade)
    periodId          String
    
    betAmount         Float      // Original bet amount
    contractAmount    Float      // After service fee deduction (98%)
    betType           MotoBetType
    betChoice         String     // Bike number (1-10), "odd", "even", "big", "small"
    targetPosition    MotoPosition // Which position to bet on (1st, 2nd, 3rd)
    
    status            MotoBetStatus @default(PENDING)
    
    motoBetResult     MotoBetResult?
    
    createdAt         DateTime   @default(now())
    updatedAt         DateTime   @updatedAt
    
    @@index([userId])
    @@index([periodId])
    @@index([status])
    @@index([betType])
    @@index([createdAt])
    @@index([userId, periodId])
}

model MotoBetResult {
    id                String     @id @default(uuid())
    bet               MotoBet    @relation(fields: [betId], references: [id], onDelete: Cascade)
    betId             String     @unique
    period            MotoPeriod @relation(fields: [periodId], references: [id], onDelete: Cascade)
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

enum MotoPeriodStatus {
    ACTIVE      // Period running, accepting bets
    ENDED       // Period ended, calculating results
    RESOLVED    // Results calculated and payouts processed
}

enum MotoBetType {
    POSITION    // Exact bike number in position
    ODD_EVEN    // Odd/Even number in position
    BIG_SMALL   // Big (6-10) / Small (1-5) in position
}

enum MotoPosition {
    FIRST       // 1st place
    SECOND      // 2nd place
    THIRD       // 3rd place
}

enum MotoBetStatus {
    PENDING     // Bet placed, period not resolved
    WON         // Bet won, payout processed
    LOST        // Bet lost
}
```

### User Model Updates
Add to existing User model:
```prisma
motoBets         MotoBet[]
```

## Phase 2: API Routes Implementation

### Route Structure (`apps/api/src/routes/moto/`)

#### 2.1 Period Routes (`period.ts`)
```typescript
// GET /moto/periods - Get current/recent periods
// GET /moto/periods/:duration - Get periods for specific duration
```

#### 2.2 Bet Routes (`bet.ts`)
```typescript
// POST /moto/bet - Place a bet
// GET /moto/bets - Get user's bets history
// GET /moto/bets/:periodId - Get user's bets for specific period
```

#### 2.3 Results Routes (`results.ts`)
```typescript
// GET /moto/results - Get recent results
// GET /moto/results/:periodId - Get specific period result
```

### Schema Definitions (`apps/api/src/schemas/moto.ts`)

```typescript
export const motoPeriodResponseSchema = z.object({
    id: z.string().uuid(),
    periodNumber: z.string(),
    durationSeconds: z.number(),
    startTime: z.string().datetime(),
    endTime: z.string().datetime(),
    firstPlace: z.number().min(1).max(10).nullable(),
    secondPlace: z.number().min(1).max(10).nullable(),
    thirdPlace: z.number().min(1).max(10).nullable(),
    status: z.enum(["ACTIVE", "ENDED", "RESOLVED"])
});

export const placeBetRequestSchema = z.object({
    periodId: z.string().uuid(),
    betType: z.enum(["POSITION", "ODD_EVEN", "BIG_SMALL"]),
    betChoice: z.string(),
    targetPosition: z.enum(["FIRST", "SECOND", "THIRD"]),
    betAmount: z.number().min(1).max(10000)
});

export const motoBetResponseSchema = z.object({
    id: z.string().uuid(),
    periodId: z.string().uuid(),
    betAmount: z.number(),
    contractAmount: z.number(),
    betType: z.enum(["POSITION", "ODD_EVEN", "BIG_SMALL"]),
    betChoice: z.string(),
    targetPosition: z.enum(["FIRST", "SECOND", "THIRD"]),
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
class MotoPeriodManager {
    // Auto-create periods for all durations
    async createPeriodsScheduler(): Promise<void>
    
    // End active periods and trigger result calculation
    async endActivePeriods(): Promise<void>
    
    // Get current active period for duration
    async getCurrentPeriod(durationSeconds: number): Promise<MotoPeriod | null>
}
```

#### 3.2 Result Generation Service (`resultGenerator.ts`)
```typescript
class MotoResultGenerator {
    // Generate unique bike numbers for 1st, 2nd, 3rd places
    generateRaceResults(): { first: number, second: number, third: number }
    
    // Ensure three distinct numbers between 1-10
    validateResultUniqueness(results: RaceResults): boolean
    
    // Process period result and save to database
    async processPeriodResult(periodId: string): Promise<void>
}
```

#### 3.3 Bet Settlement Service (`betSettlement.ts`)
```typescript
class MotoBetSettlement {
    // Calculate contract amount (98% of bet)
    calculateContractAmount(betAmount: number): number
    
    // Calculate win amount based on bet type and result
    calculateWinAmount(bet: MotoBet, result: RaceResults): number
    
    // Process all bets for a period
    async settlePeriodBets(periodId: string): Promise<void>
    
    // Update user balance and create ledger entry
    async processWinnings(betId: string, winAmount: number): Promise<void>
}
```

#### 3.4 Game Logic Service (`gameLogic.ts`)
```typescript
class MotoGameLogic {
    // Validate bet choice for bet type
    validateBetChoice(betType: string, betChoice: string): boolean
    
    // Check if bet wins based on result
    checkBetWin(bet: MotoBet, result: RaceResults): boolean
    
    // Get multiplier for winning bet
    getWinMultiplier(bet: MotoBet): number
    
    // Check if number is odd/even
    isOdd(number: number): boolean
    
    // Check if number is big (6-10) or small (1-5)
    isBig(number: number): boolean
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
**Route**: `POST /moto/bet`

**Logic Flow**:
1. Validate user authentication
2. Validate bet request (amount, choice, type, position)
3. Check if period is still active
4. Check user balance sufficient
5. Calculate contract amount (98%)
6. Create MotoBet record
7. Update user balance (deduct bet amount)
8. Return bet confirmation

### 4.2 Get Periods Endpoint
**Route**: `GET /moto/periods?duration=60`

**Logic Flow**:
1. Fetch active/recent periods for duration
2. Include current period status
3. Return periods with time remaining

### 4.3 Get Results Endpoint
**Route**: `GET /moto/results?duration=60&limit=20`

**Logic Flow**:
1. Fetch resolved periods
2. Include result details (1st, 2nd, 3rd place bikes)
3. Optionally include user's bet results

## Phase 5: Business Logic Implementation

### 5.1 Betting Rules Validation
```typescript
// Position bets: 1-10 (exact bike number)
// Odd/Even bets: odd (1,3,5,7,9), even (2,4,6,8,10)
// Big/Small bets: Big (6-10), Small (1-5)
// Target positions: FIRST, SECOND, THIRD
```

### 5.2 Payout Calculations
```typescript
const MULTIPLIERS = {
    POSITION: 9.8,      // Exact bike number match
    ODD_EVEN: 2.0,      // Odd/Even match
    BIG_SMALL: 2.0      // Big/Small match
};
```

### 5.3 Service Fee Handling
```typescript
const SERVICE_FEE_PERCENT = 2; // 2%
const contractAmount = betAmount * (100 - SERVICE_FEE_PERCENT) / 100;
```

### 5.4 Result Generation Logic
```typescript
// Generate 3 unique numbers between 1-10
// Ensure no duplicates in finishing positions
// Store as firstPlace, secondPlace, thirdPlace
```

## Phase 6: Error Handling & Validation

### 6.1 Bet Validation
- Period must be ACTIVE
- User must have sufficient balance
- Bet choice must be valid for bet type
- Amount within min/max limits
- Target position must be valid

### 6.2 Settlement Safeguards
- Idempotent processing (prevent double payouts)
- Atomic transactions
- Balance validation
- Result integrity checks (unique bike numbers)

## Phase 7: Database Indexes & Performance

### 7.1 Critical Indexes
```sql
-- Query current periods
CREATE INDEX idx_moto_period_duration_status ON "MotoPeriod" ("durationSeconds", "status");

-- User bet history
CREATE INDEX idx_moto_bet_user_created ON "MotoBet" ("userId", "createdAt" DESC);

-- Period settlement queries  
CREATE INDEX idx_moto_bet_period_status ON "MotoBet" ("periodId", "status");

-- Target position queries
CREATE INDEX idx_moto_bet_position_type ON "MotoBet" ("targetPosition", "betType");
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
├── api/src/routes/moto/
│   ├── index.ts          # Route registration
│   ├── periods.ts        # Period management routes
│   ├── bets.ts           # Betting routes  
│   └── results.ts        # Results and history routes
├── api/src/schemas/
│   └── moto.ts           # Moto-specific schemas
└── engine/src/
    ├── services/moto/
    │   ├── periodManager.ts
    │   ├── resultGenerator.ts
    │   ├── betSettlement.ts
    │   └── gameLogic.ts
    ├── scheduler/
    │   └── motoScheduler.ts
    └── index.ts          # Engine main with scheduler
```

## Notes
- Follow existing codebase patterns (Hono routes, OpenAPI schemas, Prisma conventions)
- Maintain consistency with current error handling and response formats
- Use existing logger and database connection patterns
- Implement proper TypeScript types throughout
- Follow existing authentication and authorization patterns
- Ensure race result uniqueness (no duplicate bike numbers in positions)
- Use paise-based calculations for precision (multiply by 100, do integer math, divide by 100)
- Implement idempotent settlement to prevent double payouts