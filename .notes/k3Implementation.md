# 🎲 K3 Backend Implementation Plan

## Overview
Complete implementation plan for K3 dice betting game system following existing bcwin codebase patterns and architecture. K3 is a dice-based lottery game where 3 dice (1–6 each) are rolled every period with various betting options.

## Architecture Analysis

### Current Codebase Structure
- **Monorepo**: Uses Bun with packages and apps structure
- **API App** (`apps/api`): Hono-based REST API with OpenAPI/Zod validation
- **Engine App** (`apps/engine`): Game logic processing service with cron schedulers
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
model K3Period {
    id                String   @id @default(uuid())
    periodNumber      String   @unique
    durationSeconds   Int      // 30, 60, 180, 300
    startTime         DateTime
    endTime           DateTime
    
    // Dice results (1-6 each)
    dice1             Int?     // null until resolved
    dice2             Int?
    dice3             Int?
    
    // Calculated results
    sum               Int?     // d1 + d2 + d3 (3-18)
    isTriple          Boolean? // all three dice same
    isDouble          Boolean? // at least two dice same (but not triple)
    isAllDifferent    Boolean? // all three dice unique
    isConsecutive     Boolean? // consecutive sequence (123, 234, 345, 456)
    isBig             Boolean? // sum >= 11
    isSmall           Boolean? // sum <= 10
    isOdd             Boolean? // sum is odd
    isEven            Boolean? // sum is even
    
    status            K3PeriodStatus @default(ACTIVE)
    
    k3Bets            K3Bet[]
    k3BetResults      K3BetResult[]
    
    createdAt         DateTime @default(now())
    updatedAt         DateTime @updatedAt
    
    @@index([durationSeconds])
    @@index([startTime])
    @@index([status])
    @@index([periodNumber])
}

model K3Bet {
    id                String     @id @default(uuid())
    user              User       @relation(fields: [userId], references: [id], onDelete: Cascade)
    userId            String
    period            K3Period   @relation(fields: [periodId], references: [id], onDelete: Cascade)
    periodId          String
    
    betAmount         Float      // Original bet amount
    contractAmount    Float      // After service fee deduction (98%)
    betType           K3BetType
    betChoice         String     // Varies by bet type
    
    status            K3BetStatus @default(PENDING)
    
    k3BetResult       K3BetResult?
    
    createdAt         DateTime   @default(now())
    updatedAt         DateTime   @updatedAt
    
    @@index([userId])
    @@index([periodId])
    @@index([status])
    @@index([betType])
    @@index([createdAt])
    @@index([userId, periodId])
}

model K3BetResult {
    id                String     @id @default(uuid())
    bet               K3Bet      @relation(fields: [betId], references: [id], onDelete: Cascade)
    betId             String     @unique
    period            K3Period   @relation(fields: [periodId], references: [id], onDelete: Cascade)
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

enum K3PeriodStatus {
    ACTIVE      // Period running, accepting bets
    ENDED       // Period ended, calculating results
    RESOLVED    // Results calculated and payouts processed
}

enum K3BetType {
    SUM              // Specific sum (3-18)
    TRIPLE_ANY       // Any triple (111, 222, ..., 666)
    TRIPLE_SPECIFIC  // Specific triple (e.g., 333)
    DOUBLE_ANY       // Any double (but not triple)
    DOUBLE_SPECIFIC  // Specific double combo (e.g., 4,4,6)
    ALL_DIFFERENT    // All dice unique
    TWO_NUMBERS      // Both chosen numbers appear
    CONSECUTIVE      // Consecutive sequence
    BIG              // Sum 11-18
    SMALL            // Sum 3-10
    ODD              // Sum is odd
    EVEN             // Sum is even
}

enum K3BetStatus {
    PENDING     // Bet placed, period not resolved
    WON         // Bet won, payout processed
    LOST        // Bet lost
}
```

### User Model Updates
Add to existing User model:
```prisma
k3Bets            K3Bet[]
```

## Phase 2: API Routes Implementation

### Route Structure (`apps/api/src/routes/k3/`)

#### 2.1 Period Routes (`periods.ts`)
```typescript
// GET /k3/periods - Get current/recent periods
// GET /k3/periods?duration=60 - Get periods for specific duration
```

#### 2.2 Bet Routes (`bets.ts`)
```typescript
// POST /k3/bet - Place a bet
// GET /k3/bets - Get user's bets history
// GET /k3/bets?periodId=xxx - Get user's bets for specific period
```

#### 2.3 Results Routes (`results.ts`)
```typescript
// GET /k3/results - Get recent results
// GET /k3/results/{periodId} - Get specific period result
```

### Schema Definitions (`apps/api/src/schemas/k3.ts`)

```typescript
export const k3PeriodResponseSchema = z.object({
    id: z.string().uuid(),
    periodNumber: z.string(),
    durationSeconds: z.number(),
    startTime: z.string().datetime(),
    endTime: z.string().datetime(),
    dice1: z.number().min(1).max(6).nullable(),
    dice2: z.number().min(1).max(6).nullable(),
    dice3: z.number().min(1).max(6).nullable(),
    sum: z.number().min(3).max(18).nullable(),
    isTriple: z.boolean().nullable(),
    isDouble: z.boolean().nullable(),
    isAllDifferent: z.boolean().nullable(),
    isConsecutive: z.boolean().nullable(),
    isBig: z.boolean().nullable(),
    isSmall: z.boolean().nullable(),
    isOdd: z.boolean().nullable(),
    isEven: z.boolean().nullable(),
    status: z.enum(["ACTIVE", "ENDED", "RESOLVED"])
});

export const placeBetRequestSchema = z.object({
    periodId: z.string().uuid(),
    betType: z.enum([
        "SUM", "TRIPLE_ANY", "TRIPLE_SPECIFIC", "DOUBLE_ANY", 
        "DOUBLE_SPECIFIC", "ALL_DIFFERENT", "TWO_NUMBERS", 
        "CONSECUTIVE", "BIG", "SMALL", "ODD", "EVEN"
    ]),
    betChoice: z.string(), // Format depends on betType
    betAmount: z.number().min(1).max(10000)
});

export const k3BetResponseSchema = z.object({
    id: z.string().uuid(),
    periodId: z.string().uuid(),
    periodNumber: z.string(),
    betAmount: z.number(),
    contractAmount: z.number(),
    betType: z.enum([
        "SUM", "TRIPLE_ANY", "TRIPLE_SPECIFIC", "DOUBLE_ANY", 
        "DOUBLE_SPECIFIC", "ALL_DIFFERENT", "TWO_NUMBERS", 
        "CONSECUTIVE", "BIG", "SMALL", "ODD", "EVEN"
    ]),
    betChoice: z.string(),
    status: z.enum(["PENDING", "WON", "LOST"]),
    result: z.object({
        isWin: z.boolean(),
        winAmount: z.number(),
        multiplier: z.number().nullable()
    }).nullable(),
    createdAt: z.string().datetime()
});

export const periodsRequestSchema = z.object({
    duration: z.coerce.number().optional(),
    limit: z.coerce.number().min(1).max(50).default(10)
});

export const userBetsRequestSchema = z.object({
    periodId: z.string().uuid().optional(),
    duration: z.coerce.number().optional(),
    limit: z.coerce.number().min(1).max(100).default(20),
    offset: z.coerce.number().min(0).default(0)
});

export const resultsRequestSchema = z.object({
    duration: z.coerce.number().optional(),
    limit: z.coerce.number().min(1).max(50).default(10)
});
```

## Phase 3: Engine Service Implementation

### Core Services (`apps/engine/src/services/k3/`)

#### 3.1 Period Management Service (`periodManager.ts`)
```typescript
class PeriodManager {
    // Calculate period times based on duration
    private calculatePeriodTimes(durationSeconds: number): {
        startTime: Date;
        endTime: Date;
    }
    
    // Generate unique period number
    private generatePeriodNumber(durationSeconds: number): string
    
    // Create periods for all durations if needed
    async createPeriodsForAllDurations(): Promise<void>
    
    // Create period for specific duration if needed
    async createPeriodIfNeeded(durationSeconds: number): Promise<K3Period | null>
    
    // End active periods whose time has expired
    async endActivePeriods(): Promise<void>
    
    // Get current active period for duration
    async getCurrentPeriod(durationSeconds: number): Promise<K3Period | null>
    
    // Get ended periods without results
    async getEndedPeriods(): Promise<K3Period[]>
    
    // Update period status to resolved
    async updatePeriodToResolved(periodId: string): Promise<void>
}
```

#### 3.2 Result Generation Service (`resultGenerator.ts`)
```typescript
interface DiceResult {
    dice1: number;
    dice2: number;
    dice3: number;
    sum: number;
    isTriple: boolean;
    isDouble: boolean;
    isAllDifferent: boolean;
    isConsecutive: boolean;
    isBig: boolean;
    isSmall: boolean;
    isOdd: boolean;
    isEven: boolean;
}

class ResultGenerator {
    // Generate random dice roll (1-6)
    generateDiceRoll(): number
    
    // Generate complete dice result with all calculations
    generateCompleteResult(): DiceResult
    
    // Check if numbers form consecutive sequence
    private isConsecutiveSequence(d1: number, d2: number, d3: number): boolean
    
    // Process result for a specific period
    async processPeriodResult(periodId: string): Promise<DiceResult | null>
    
    // Process all ended periods without results
    async processAllEndedPeriods(): Promise<void>
}
```

#### 3.3 Bet Settlement Service (`betSettlement.ts`)
```typescript
interface PeriodResult {
    dice1: number;
    dice2: number;
    dice3: number;
    sum: number;
    isTriple: boolean;
    isDouble: boolean;
    isAllDifferent: boolean;
    isConsecutive: boolean;
    isBig: boolean;
    isSmall: boolean;
    isOdd: boolean;
    isEven: boolean;
}

class BetSettlement {
    // Settle all bets for a specific period
    async settlePeriodBets(periodId: string): Promise<void>
    
    // Settle individual bet
    private async settleBet(bet: K3Bet, result: PeriodResult): Promise<void>
    
    // Settle all ended periods that have results
    async settleAllEndedPeriodsWithResults(): Promise<void>
    
    // Get settlement statistics for a period
    async getSettlementStats(periodId: string): Promise<{
        totalBets: number;
        totalWinners: number;
        totalPayout: number;
        totalBetAmount: number;
    } | null>
}
```

#### 3.4 Game Logic Service (`gameLogic.ts`)
```typescript
class GameLogic {
    // Validate bet choice for specific bet type
    static validateBetChoice(betType: string, betChoice: string): boolean
    
    // Check if bet wins based on result
    static checkBetWin(bet: K3Bet, result: PeriodResult): boolean
    
    // Get multiplier for winning bet
    static getWinMultiplier(bet: K3Bet, result: PeriodResult): number
    
    // Calculate win amount
    static calculateWinAmount(bet: K3Bet, result: PeriodResult): number
    
    // Get human-readable result description
    static getResultDescription(result: PeriodResult): string
    
    // Validate specific bet choices by type
    private static validateSumBet(betChoice: string): boolean
    private static validateTripleSpecific(betChoice: string): boolean
    private static validateDoubleSpecific(betChoice: string): boolean
    private static validateTwoNumbers(betChoice: string): boolean
}
```

### Scheduler Implementation (`apps/engine/src/scheduler/k3Scheduler.ts`)
```typescript
export class K3Scheduler {
    private periodManager: PeriodManager;
    private resultGenerator: ResultGenerator;
    private betSettlement: BetSettlement;
    private task: ScheduledTask | null = null;
    private isTaskRunning = false;

    constructor() {
        this.periodManager = new PeriodManager();
        this.resultGenerator = new ResultGenerator();
        this.betSettlement = new BetSettlement();
    }

    start(): void {
        // Runs every 30 seconds at :00 and :30
        this.task = cron.schedule("*/30 * * * * *", async () => {
            if (this.isTaskRunning) return;
            
            this.isTaskRunning = true;
            try {
                await new Promise(resolve => setTimeout(resolve, 1000));
                await this.runCycle();
            } catch (error) {
                logger.error("K3 scheduler cycle error:", error);
            } finally {
                this.isTaskRunning = false;
            }
        });
        
        this.task.start();
    }

    private async runCycle(): Promise<void> {
        // 1. End expired periods
        await this.periodManager.endActivePeriods();
        
        // 2. Create new periods for all durations
        await this.periodManager.createPeriodsForAllDurations();
        
        // 3. Generate results for ended periods
        await this.resultGenerator.processAllEndedPeriods();
        
        // 4. Settle bets for periods with results
        await this.betSettlement.settleAllEndedPeriodsWithResults();
    }

    stop(): void {
        if (this.task) {
            this.task.stop();
            this.task = null;
        }
    }
}
```

## Phase 4: Business Logic Implementation

### 4.1 Betting Rules Validation
```typescript
const BET_CHOICE_VALIDATORS = {
    SUM: (choice: string) => {
        const num = parseInt(choice);
        return !isNaN(num) && num >= 3 && num <= 18;
    },
    
    TRIPLE_SPECIFIC: (choice: string) => {
        const num = parseInt(choice);
        return !isNaN(num) && num >= 1 && num <= 6;
    },
    
    DOUBLE_SPECIFIC: (choice: string) => {
        // Format: "4,4,6" or "4-4-6"
        const parts = choice.split(/[,-]/).map(n => parseInt(n.trim()));
        if (parts.length !== 3) return false;
        
        const counts = parts.reduce((acc, n) => {
            acc[n] = (acc[n] || 0) + 1;
            return acc;
        }, {});
        
        const values = Object.values(counts);
        return values.includes(2) && values.includes(1);
    },
    
    TWO_NUMBERS: (choice: string) => {
        // Format: "2,5" or "2-5"
        const parts = choice.split(/[,-]/).map(n => parseInt(n.trim()));
        return parts.length === 2 && 
               parts.every(n => n >= 1 && n <= 6) && 
               parts[0] !== parts[1];
    }
};
```

### 4.2 Payout Multipliers
```typescript
const K3_MULTIPLIERS = {
    // Sum multipliers based on probability
    SUM: {
        3: 50, 4: 30, 5: 18, 6: 12, 7: 8, 8: 6,
        9: 6, 10: 6, 11: 6, 12: 6, 13: 8, 14: 12,
        15: 18, 16: 30, 17: 50, 18: 50
    },
    
    TRIPLE_SPECIFIC: 150,     // Specific triple (e.g., 333)
    TRIPLE_ANY: 24,           // Any triple
    DOUBLE_SPECIFIC: 8,       // Specific double combo
    DOUBLE_ANY: 3,            // Any double (not triple)
    ALL_DIFFERENT: 6,         // All dice different
    TWO_NUMBERS: 5,           // Both numbers appear
    CONSECUTIVE: 50,          // Consecutive sequence
    BIG: 1.95,               // Sum 11-18
    SMALL: 1.95,             // Sum 3-10
    ODD: 1.95,               // Odd sum
    EVEN: 1.95               // Even sum
};
```

### 4.3 Service Fee Handling
```typescript
const SERVICE_FEE_PERCENT = 2; // 2%

function calculateContractAmount(betAmount: number): number {
    return (betAmount * (100 - SERVICE_FEE_PERCENT)) / 100;
}
```

## Phase 5: API Implementation Details

### 5.1 Place Bet Endpoint
**Route**: `POST /k3/bet`

**Logic Flow**:
1. Validate user authentication
2. Validate bet request (type, choice, amount)
3. Check if period is still active
4. Check user balance sufficient
5. Calculate contract amount (98%)
6. Create K3Bet record in transaction
7. Update user balance (deduct bet amount)
8. Return bet confirmation with WebSocket notification

### 5.2 Get Periods Endpoint
**Route**: `GET /k3/periods?duration=60&limit=10`

**Logic Flow**:
1. Fetch periods for specified duration (or all)
2. Include current active period
3. Return periods with calculated time remaining
4. Include period status and basic result info

### 5.3 Get Results Endpoint
**Route**: `GET /k3/results?duration=60&limit=20`

**Logic Flow**:
1. Fetch resolved periods with results
2. Include dice values and calculated properties
3. Optionally include user's bet results for each period
4. Return paginated results

## Phase 6: Error Handling & Validation

### 6.1 Bet Validation Errors
- `INVALID_PERIOD`: Period not found or not active
- `INSUFFICIENT_BALANCE`: User balance too low
- `INVALID_BET_CHOICE`: Bet choice invalid for bet type
- `BETTING_CLOSED`: Period ended while processing
- `INVALID_AMOUNT`: Amount outside min/max limits

### 6.2 Settlement Safeguards
- Idempotent processing (prevent double payouts)
- Atomic transactions for balance updates
- Result integrity validation
- Comprehensive error logging

## Phase 7: Database Indexes & Performance

### 7.1 Critical Indexes
```sql
-- Query current periods
CREATE INDEX idx_k3_period_duration_status ON "K3Period" ("durationSeconds", "status");

-- User bet history
CREATE INDEX idx_k3_bet_user_created ON "K3Bet" ("userId", "createdAt" DESC);

-- Period settlement queries  
CREATE INDEX idx_k3_bet_period_status ON "K3Bet" ("periodId", "status");

-- Results lookup
CREATE INDEX idx_k3_period_resolved ON "K3Period" ("status", "endTime") WHERE "status" = 'RESOLVED';
```

## Phase 8: Implementation Order

1. **Database Schema** - Add Prisma models and run migration
2. **Core Engine Services** - Period management, result generation, game logic
3. **Basic API Routes** - Period fetching, bet validation endpoints
4. **Scheduler Integration** - Automated period and result processing
5. **Settlement Logic** - Bet evaluation and payout processing
6. **API Completion** - Full endpoint implementation with error handling
7. **WebSocket Integration** - Real-time updates for results and balances
8. **Caching Layer** - Performance optimization for frequent queries
9. **Testing** - Unit tests and integration tests
10. **Performance Optimization** - Query optimization and monitoring

## Phase 9: File Structure

```
apps/
├── api/src/routes/k3/
│   ├── index.ts          # Route registration
│   ├── periods.ts        # Period management routes
│   ├── bets.ts           # Betting routes  
│   └── results.ts        # Results and history routes
├── api/src/schemas/
│   └── k3.ts             # K3-specific schemas
└── engine/src/
    ├── services/k3/
    │   ├── periodManager.ts
    │   ├── resultGenerator.ts
    │   ├── betSettlement.ts
    │   └── gameLogic.ts
    ├── scheduler/
    │   └── k3Scheduler.ts
    └── index.ts          # Engine main with K3 scheduler
```

## Phase 10: Special Considerations

### 10.1 Dice Result Validation
- Ensure all dice values are 1-6
- Verify calculated properties match dice values
- Prevent result tampering with checksums

### 10.2 Complex Bet Types
- **Double Specific**: Validate format and ensure exactly one pair
- **Two Numbers**: Ensure both numbers appear in result
- **Consecutive**: Handle all valid sequences (123, 234, 345, 456)

### 10.3 WebSocket Events
```typescript
// Real-time events to publish
const WEBSOCKET_EVENTS = {
    'k3-period-creation': 'New period started',
    'k3-results': 'Period results available', 
    'k3-bet-settlement': 'Bet settled',
    'account-balance': 'User balance updated'
};
```

## Notes
- Follow existing codebase patterns (Hono routes, OpenAPI schemas, Prisma conventions)
- Maintain consistency with Wingo implementation for similar features
- Use existing logger, cache, and WebSocket patterns
- Implement comprehensive TypeScript types
- Follow existing authentication and authorization patterns
- Ensure atomic transactions for all financial operations
- Implement proper error handling and logging throughout