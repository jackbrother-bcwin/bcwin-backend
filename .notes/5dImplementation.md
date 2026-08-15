# 🎲 5D Game Backend Implementation Plan

## Overview
Complete implementation plan for 5D betting game system following existing bcwin codebase patterns and architecture.

## Architecture Analysis

### Current Codebase Structure
- **Monorepo**: Uses Bun with packages and apps structure
- **API App** (`apps/api`): Hono-based REST API with OpenAPI/Zod validation
- **Engine App** (`apps/engine`): Game logic processing service with cron-based schedulers
- **Packages**: Shared utilities (db, logger, cache, websocket)
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
model FiveDPeriod {
    id                String   @id @default(uuid())
    periodNumber      String   @unique
    durationSeconds   Int      // 30, 60, 180, 300
    startTime         DateTime
    endTime           DateTime
    resultNumber      String?  // 5-digit number (00000-99999)
    resultDigitA      Int?     // First digit (0-9)
    resultDigitB      Int?     // Second digit (0-9)
    resultDigitC      Int?     // Third digit (0-9)
    resultDigitD      Int?     // Fourth digit (0-9)
    resultDigitE      Int?     // Fifth digit (0-9)
    resultSum         Int?     // Sum of all digits (0-45)
    status            FiveDPeriodStatus @default(ACTIVE)
    
    fiveDBets         FiveDBet[]
    fiveDBetResults   FiveDBetResult[]
    
    createdAt         DateTime @default(now())
    updatedAt         DateTime @updatedAt
    
    @@index([durationSeconds])
    @@index([startTime])
    @@index([status])
    @@index([periodNumber])
}

model FiveDBet {
    id                String     @id @default(uuid())
    user              User       @relation(fields: [userId], references: [id], onDelete: Cascade)
    userId            String
    period            FiveDPeriod @relation(fields: [periodId], references: [id], onDelete: Cascade)
    periodId          String
    
    betAmount         Float      // Original bet amount
    contractAmount    Float      // After service fee deduction (98%)
    betType           FiveDBetType
    betCategory       FiveDBetCategory // POSITION or SUM
    betChoice         String     // Specific bet choice (0-9, LOW, HIGH, ODD, EVEN for position; 0-45 for sum)
    position          FiveDPosition?   // A, B, C, D, E for position bets
    
    status            FiveDBetStatus @default(PENDING)
    
    fiveDBetResult    FiveDBetResult?
    
    createdAt         DateTime   @default(now())
    updatedAt         DateTime   @updatedAt
    
    @@index([userId])
    @@index([periodId])
    @@index([status])
    @@index([betType])
    @@index([betCategory])
    @@index([position])
    @@index([createdAt])
    @@index([userId, periodId])
}

model FiveDBetResult {
    id                String     @id @default(uuid())
    bet               FiveDBet   @relation(fields: [betId], references: [id], onDelete: Cascade)
    betId             String     @unique
    period            FiveDPeriod @relation(fields: [periodId], references: [id], onDelete: Cascade)
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

enum FiveDPeriodStatus {
    ACTIVE      // Period running, accepting bets
    ENDED       // Period ended, calculating results
    RESOLVED    // Results calculated and payouts processed
}

enum FiveDBetType {
    EXACT_NUMBER    // Position exact number (0-9)
    LOW            // Position low (0-4) or Sum low (0-22)
    HIGH           // Position high (5-9) or Sum high (23-45)
    ODD            // Position odd or Sum odd
    EVEN           // Position even or Sum even
    SUM_EXACT      // Sum exact number (0-45)
}

enum FiveDBetCategory {
    POSITION       // Position-based bets (A-E)
    SUM           // Sum-based bets
}

enum FiveDBetStatus {
    PENDING     // Bet placed, period not resolved
    WON         // Bet won, payout processed
    LOST        // Bet lost
}

enum FiveDPosition {
    A           // First digit
    B           // Second digit  
    C           // Third digit
    D           // Fourth digit
    E           // Fifth digit
}
```

### User Model Updates
Add to existing User model:
```prisma
fiveDBets         FiveDBet[]
```

## Phase 2: API Routes Implementation

### Route Structure (`apps/api/src/routes/5d/`)

#### 2.1 Period Routes (`period.ts`)
```typescript
// GET /5d/periods - Get current/recent periods
// GET /5d/periods/:duration - Get periods for specific duration
```

#### 2.2 Bet Routes (`bet.ts`)
```typescript
// POST /5d/bet - Place a bet
// GET /5d/bets - Get user's bets history
// GET /5d/bets/:periodId - Get user's bets for specific period
```

#### 2.3 Results Routes (`results.ts`)
```typescript
// GET /5d/results - Get recent results
// GET /5d/results/:periodId - Get specific period result
```

### Schema Definitions (`apps/api/src/schemas/5d.ts`)

```typescript
export const fiveDPeriodResponseSchema = z.object({
    id: z.string().uuid(),
    periodNumber: z.string(),
    durationSeconds: z.number(),
    startTime: z.string().datetime(),
    endTime: z.string().datetime(),
    resultNumber: z.string().length(5).nullable(), // "12345"
    resultDigitA: z.number().min(0).max(9).nullable(),
    resultDigitB: z.number().min(0).max(9).nullable(),
    resultDigitC: z.number().min(0).max(9).nullable(),
    resultDigitD: z.number().min(0).max(9).nullable(),
    resultDigitE: z.number().min(0).max(9).nullable(),
    resultSum: z.number().min(0).max(45).nullable(),
    status: z.enum(["ACTIVE", "ENDED", "RESOLVED"])
});

export const place5DBetRequestSchema = z.object({
    periodId: z.string().uuid(),
    betCategory: z.enum(["POSITION", "SUM"]),
    betType: z.enum(["EXACT_NUMBER", "LOW", "HIGH", "ODD", "EVEN", "SUM_EXACT"]),
    position: z.enum(["A", "B", "C", "D", "E"]).optional(), // Required for POSITION category
    betChoice: z.string(), // 0-9, LOW, HIGH, ODD, EVEN, or 0-45 for sum
    betAmount: z.number().min(1).max(10000)
});

export const fiveDBetResponseSchema = z.object({
    id: z.string().uuid(),
    periodId: z.string().uuid(),
    betAmount: z.number(),
    contractAmount: z.number(),
    betCategory: z.enum(["POSITION", "SUM"]),
    betType: z.enum(["EXACT_NUMBER", "LOW", "HIGH", "ODD", "EVEN", "SUM_EXACT"]),
    position: z.enum(["A", "B", "C", "D", "E"]).nullable(),
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

### Core Services (`apps/engine/src/services/5d/`)

#### 3.1 Period Management Service (`periodManager.ts`)
```typescript
class FiveDPeriodManager {
    // Auto-create periods for all durations
    async createPeriodsForAllDurations(): Promise<void>
    
    // End active periods and trigger result calculation
    async endActivePeriods(): Promise<void>
    
    // Get current active period for duration
    async getCurrentPeriod(durationSeconds: number): Promise<FiveDPeriod | null>
    
    // Get ended periods waiting for result generation
    async getEndedPeriods(): Promise<FiveDPeriod[]>
    
    // Mark period as resolved
    async updatePeriodToResolved(periodId: string): Promise<void>
}
```

#### 3.2 Result Generation Service (`resultGenerator.ts`)
```typescript
class FiveDResultGenerator {
    // Generate random 5-digit number (00000-99999)
    generateResult5D(): string
    
    // Parse digits from 5-digit number
    parseDigits(resultNumber: string): {
        digitA: number;
        digitB: number;
        digitC: number;
        digitD: number;
        digitE: number;
        sum: number;
    }
    
    // Process period result and update database
    async processePeriodResult(periodId: string): Promise<void>
    
    // Process all ended periods
    async processAllEndedPeriods(): Promise<void>
}
```

#### 3.3 Bet Settlement Service (`betSettlement.ts`)
```typescript
class FiveDSettlement {
    // Calculate contract amount (98% of bet)
    calculateContractAmount(betAmount: number): number
    
    // Calculate win amount based on bet type and result
    calculateWinAmount(bet: FiveDBet, result: PeriodResult): number
    
    // Process all bets for a period
    async settlePeriodBets(periodId: string): Promise<void>
    
    // Update user balance and create ledger entry
    async processWinnings(betId: string, winAmount: number): Promise<void>
    
    // Settle all periods with results
    async settleAllEndedPeriodsWithResults(): Promise<void>
}
```

#### 3.4 Game Logic Service (`gameLogic.ts`)
```typescript
class FiveDGameLogic {
    // Validate bet choice for bet type and category
    validateBetChoice(betCategory: string, betType: string, betChoice: string, position?: string): boolean
    
    // Check if bet wins based on result
    checkBetWin(bet: FiveDBet, result: PeriodResult): boolean
    
    // Get multiplier for winning bet
    getWinMultiplier(bet: FiveDBet, result: PeriodResult): number
    
    // Position bet validation and win checking
    checkPositionBetWin(bet: FiveDBet, digitValue: number): boolean
    
    // Sum bet validation and win checking
    checkSumBetWin(bet: FiveDBet, sumValue: number): boolean
}
```

### Scheduler Implementation (`apps/engine/src/scheduler/5dScheduler.ts`)
```typescript
// Similar to WingoScheduler with cron-based execution
// Cron jobs for different game durations:
// - Every 30s: 30-second games
// - Every 1m: 1-minute games  
// - Every 3m: 3-minute games
// - Every 5m: 5-minute games

export class FiveDScheduler {
    private periodManager: FiveDPeriodManager;
    private resultGenerator: FiveDResultGenerator;
    private betSettlement: FiveDSettlement;
    private task: ScheduledTask | null = null;
    private isTaskRunning = false;
    
    // Same pattern as WingoScheduler with 30-second intervals
    start(): void
    stop(): void
    private async runCycle(): Promise<void>
    async runManualCycle(): Promise<void>
}
```

## Phase 4: API Implementation Details

### 4.1 Place Bet Endpoint
**Route**: `POST /5d/bet`

**Logic Flow**:
1. Validate user authentication
2. Validate bet request (category, type, position, choice, amount)
3. Check if period is still active
4. Check user balance sufficient
5. Validate bet choice for specific bet type
6. Calculate contract amount (98%)
7. Create FiveDBet record
8. Update user balance (deduct bet amount)
9. Return bet confirmation

### 4.2 Get Periods Endpoint
**Route**: `GET /5d/periods?duration=60`

**Logic Flow**:
1. Fetch active/recent periods for duration
2. Include current period status and time remaining
3. Return periods with result details if resolved

### 4.3 Get Results Endpoint
**Route**: `GET /5d/results?duration=60&limit=20`

**Logic Flow**:
1. Fetch resolved periods
2. Include full result details (5-digit number, individual digits, sum)
3. Optionally include user's bet results

## Phase 5: Business Logic Implementation

### 5.1 Betting Rules Validation
```typescript
// Position bets validation
const POSITION_CHOICES = {
    EXACT_NUMBER: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
    LOW: ["LOW"],           // 0-4
    HIGH: ["HIGH"],         // 5-9
    ODD: ["ODD"],          // 1,3,5,7,9
    EVEN: ["EVEN"]         // 0,2,4,6,8
};

// Sum bets validation
const SUM_CHOICES = {
    SUM_EXACT: Array.from({length: 46}, (_, i) => i.toString()), // 0-45
    LOW: ["LOW"],          // 0-22
    HIGH: ["HIGH"],        // 23-45
    ODD: ["ODD"],         // Odd sums
    EVEN: ["EVEN"]        // Even sums
};
```

### 5.2 Payout Calculations
```typescript
const MULTIPLIERS = {
    POSITION_EXACT: 9.0,    // Position exact number match
    POSITION_LOW_HIGH: 1.95, // Position low/high
    POSITION_ODD_EVEN: 1.95, // Position odd/even
    SUM_EXACT: 45.0,        // Sum exact match
    SUM_LOW_HIGH: 1.95,     // Sum low/high
    SUM_ODD_EVEN: 1.95      // Sum odd/even
};
```

### 5.3 Service Fee Handling
```typescript
const SERVICE_FEE_PERCENT = 2; // 2%
const contractAmount = betAmount * (100 - SERVICE_FEE_PERCENT) / 100;
```

### 5.4 Win Logic Implementation
```typescript
// Position bet win checking
function checkPositionWin(betType: string, betChoice: string, digitValue: number): boolean {
    switch (betType) {
        case "EXACT_NUMBER":
            return parseInt(betChoice) === digitValue;
        case "LOW":
            return digitValue >= 0 && digitValue <= 4;
        case "HIGH":
            return digitValue >= 5 && digitValue <= 9;
        case "ODD":
            return digitValue % 2 === 1;
        case "EVEN":
            return digitValue % 2 === 0;
        default:
            return false;
    }
}

// Sum bet win checking
function checkSumWin(betType: string, betChoice: string, sumValue: number): boolean {
    switch (betType) {
        case "SUM_EXACT":
            return parseInt(betChoice) === sumValue;
        case "LOW":
            return sumValue >= 0 && sumValue <= 22;
        case "HIGH":
            return sumValue >= 23 && sumValue <= 45;
        case "ODD":
            return sumValue % 2 === 1;
        case "EVEN":
            return sumValue % 2 === 0;
        default:
            return false;
    }
}
```

## Phase 6: Error Handling & Validation

### 6.1 Bet Validation
- Period must be ACTIVE
- User must have sufficient balance
- Bet choice must be valid for bet type and category
- Position must be specified for POSITION category bets
- Amount within min/max limits
- betCategory and betType combination must be valid

### 6.2 Settlement Safeguards
- Idempotent processing (prevent double payouts)
- Atomic transactions for balance updates
- Balance validation before processing winnings
- Result integrity checks (5-digit format, digit range validation)
- Sum calculation verification

## Phase 7: Database Indexes & Performance

### 7.1 Critical Indexes
```sql
-- Query current periods
CREATE INDEX idx_5d_period_duration_status ON "FiveDPeriod" ("durationSeconds", "status");

-- User bet history
CREATE INDEX idx_5d_bet_user_created ON "FiveDBet" ("userId", "createdAt" DESC);

-- Period settlement queries  
CREATE INDEX idx_5d_bet_period_status ON "FiveDBet" ("periodId", "status");

-- Bet filtering
CREATE INDEX idx_5d_bet_category_type ON "FiveDBet" ("betCategory", "betType");
CREATE INDEX idx_5d_bet_position ON "FiveDBet" ("position");
```

## Phase 8: Implementation Order

1. **Database Schema** - Add Prisma models and run migration
2. **Basic API Routes** - Period fetching, bet placement validation
3. **Engine Core Services** - Period creation, result generation logic
4. **Game Logic Implementation** - Bet validation and win calculation
5. **Settlement Logic** - Bet evaluation and payout processing
6. **Scheduler Integration** - Automated period management
7. **API Completion** - Full endpoint implementation with proper validation
8. **Error Handling** - Comprehensive validation and error responses
9. **Testing** - Unit tests and integration tests for complex game logic
10. **Performance Optimization** - Caching, indexes, query optimization

## Phase 9: File Structure

```
apps/
├── api/src/routes/5d/
│   ├── index.ts          # Route registration
│   ├── periods.ts        # Period management routes
│   ├── bets.ts           # Betting routes  
│   └── results.ts        # Results and history routes
├── api/src/schemas/
│   └── 5d.ts             # 5D-specific schemas
└── engine/src/
    ├── services/5d/
    │   ├── periodManager.ts
    │   ├── resultGenerator.ts
    │   ├── betSettlement.ts
    │   └── gameLogic.ts
    ├── scheduler/
    │   └── 5dScheduler.ts
    └── index.ts          # Engine main with scheduler registration
```

## Phase 10: WebSocket Integration

### 10.1 Real-time Updates
```typescript
// Period creation notifications
WebSocketManager.publishToTopic("5d-period-creation", periodData);

// Result announcements
WebSocketManager.publishToTopic("5d-results", resultData);

// Bet settlement notifications (user-specific)
WebSocketManager.publishToUser(userId, "5d-bet-result", betResultData);
```

## Phase 11: Testing Strategy

### 11.1 Unit Tests
- Game logic validation (win/lose scenarios)
- Result generation (5-digit number parsing)
- Multiplier calculations
- Bet validation logic

### 11.2 Integration Tests
- Full betting workflow
- Period lifecycle management
- Settlement processing
- Balance updates

### 11.3 Edge Case Testing
- Boundary values (sum=0, sum=45)
- All position combinations (A-E)
- Concurrent bet placement
- Scheduler timing edge cases

## Notes
- Follow existing codebase patterns (Hono routes, OpenAPI schemas, Prisma conventions)
- Maintain consistency with current error handling and response formats
- Use existing logger, database connection, and WebSocket patterns
- Implement proper TypeScript types throughout
- Follow existing authentication and authorization patterns
- Consider rate limiting for bet placement
- Implement proper audit logging for financial transactions
- Ensure idempotent operations for critical financial processes