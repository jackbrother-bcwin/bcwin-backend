# 🏆 Commission & VIP Promotion System Implementation Plan

## 📋 Project Structure & Practices

### Architecture Overview
- **Monorepo Structure**: Multi-app setup with shared packages
- **Apps**:
  - `apps/api`: REST API service (Hono framework, port 3000)
  - `apps/engine`: Background processing service (schedulers, port 3001)
- **Packages**:
  - `@bcwin/db`: Prisma client and schema
  - `@bcwin/cache`: Redis operations
  - `@bcwin/logger`: Centralized logging
  - `@bcwin/websocket`: WebSocket management

### Technology Stack
- **Runtime**: Bun
- **Framework**: Hono (OpenAPI support)
- **Database**: PostgreSQL with Prisma ORM
- **Cache**: Redis (ioredis)
- **Scheduling**: node-cron
- **Validation**: Zod schemas

### Development Practices
- **File Structure**: Feature-based routing (`apps/api/src/routes/{feature}/`)
- **Schedulers**: Located in `apps/engine/src/scheduler/`
- **Services**: Game logic in `apps/engine/src/services/{game}/`
- **Shared Libraries**: Place reusable logic in `apps/api/src/lib/`
- **Schema Validation**: Zod schemas in `apps/api/src/schemas/`
- **Middleware**: Authentication and metrics in `apps/api/src/middleware/`

---

## 🗃️ Phase 1: Database Migration (Prisma Schema Changes)

### 1.1 Commission System Tables

Add to `packages/db/schema.prisma`:

```prisma
// VIP Level tracking
model UserVipLevel {
    id           String   @id @default(uuid())
    user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
    userId       String   @unique
    currentLevel Int      @default(0) // 0-10
    teamSize     Int      @default(0)
    teamBetting  Float    @default(0) // Total team betting amount
    teamDeposit  Float    @default(0) // Total team deposit amount
    
    // Promotion tracking
    lastCalculatedAt DateTime @default(now())
    
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt
    
    @@index([currentLevel])
    @@index([lastCalculatedAt])
}

// Commission records
model Commission {
    id               String   @id @default(uuid())
    user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)
    userId           String
    fromUser         User     @relation("CommissionFrom", fields: [fromUserId], references: [id], onDelete: Cascade)
    fromUserId       String
    
    // Commission details
    layer            Int      // 1-6 subordinate level
    userVipLevel     Int      // VIP level at time of commission
    commissionRate   Float    // Percentage rate applied
    betAmount        Float    // Original bet amount from subordinate
    commissionAmount Float    // Calculated commission amount
    
    // Bet reference (polymorphic)
    betType          String   // "WINGO", "5D", "K3", "MOTO"
    betId            String   // Reference to specific bet
    
    // Calculation date (for daily aggregation)
    calculationDate  DateTime // Date when commission was calculated (truncated to day)
    
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt
    
    @@index([userId])
    @@index([fromUserId])
    @@index([layer])
    @@index([calculationDate])
    @@index([betType])
    @@index([userId, calculationDate])
    @@index([fromUserId, calculationDate])
}

// Daily commission summary for quick API responses
model DailyCommissionSummary {
    id               String   @id @default(uuid())
    user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)
    userId           String
    date             DateTime // Date (truncated to day)
    
    totalCommission  Float    @default(0)
    layer1Commission Float    @default(0)
    layer2Commission Float    @default(0)
    layer3Commission Float    @default(0)
    layer4Commission Float    @default(0)
    layer5Commission Float    @default(0)
    layer6Commission Float    @default(0)
    
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt
    
    @@unique([userId, date])
    @@index([date])
    @@index([userId])
}

// Team metrics cache for VIP calculations
model TeamMetrics {
    id           String   @id @default(uuid())
    user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
    userId       String   @unique
    
    // Direct team (Layer 1)
    directTeamSize    Int     @default(0)
    directTeamBetting Float   @default(0)
    directTeamDeposit Float   @default(0)
    
    // Total team (Layers 1-6)
    totalTeamSize    Int     @default(0)
    totalTeamBetting Float   @default(0)
    totalTeamDeposit Float   @default(0)
    
    lastUpdated DateTime @default(now())
    
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt
    
    @@index([totalTeamSize])
    @@index([totalTeamBetting])
    @@index([totalTeamDeposit])
    @@index([lastUpdated])
}
```

### 1.2 Update User Model Relations

```prisma
model User {
    // ... existing fields ...
    
    // Commission relations
    commissions         Commission[] @relation("Commission")
    commissionsFrom     Commission[] @relation("CommissionFrom")
    dailyCommissions    DailyCommissionSummary[]
    vipLevel            UserVipLevel?
    teamMetrics         TeamMetrics?
    
    // ... existing relations ...
}
```

### 1.3 Commission Rate Configuration Table

```prisma
model CommissionRateConfig {
    id       String @id @default(uuid())
    vipLevel Int    @unique // 0-10
    layer1   Float  // Commission rate for layer 1
    layer2   Float  // Commission rate for layer 2
    layer3   Float  // Commission rate for layer 3
    layer4   Float  // Commission rate for layer 4
    layer5   Float  // Commission rate for layer 5
    layer6   Float  // Commission rate for layer 6
    
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt
    
    @@index([vipLevel])
}

model VipLevelRequirement {
    id           String @id @default(uuid())
    level        Int    @unique // 0-10
    teamSize     Int    // Required team size
    teamBetting  Float  // Required team betting amount
    teamDeposit  Float  // Required team deposit amount
    
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt
    
    @@index([level])
}
```

---

## ⚙️ Phase 2: Commission Calculation System

### 2.1 Commission Calculator Service

**Location**: `apps/engine/src/services/commission/commissionCalculator.ts`

```typescript
import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";

export class CommissionCalculator {
    private logger = new Logger("commission-calculator");

    // Calculate commission for a bet and distribute to upline
    async calculateCommissionForBet(
        betId: string,
        betType: string,
        userId: string,
        betAmount: float,
        contractAmount: float
    ): Promise<void> {
        // Get user's upline chain (6 levels)
        const uplineChain = await this.getUplineChain(userId, 6);
        
        for (let layer = 1; layer <= uplineChain.length; layer++) {
            const uplineUser = uplineChain[layer - 1];
            
            // Get current VIP level of upline user
            const vipLevel = await this.getCurrentVipLevel(uplineUser.id);
            
            // Get commission rate for this VIP level and layer
            const commissionRate = await this.getCommissionRate(vipLevel, layer);
            
            // Calculate commission amount
            const commissionAmount = contractAmount * (commissionRate / 100);
            
            if (commissionAmount > 0) {
                // Record commission
                await this.recordCommission({
                    userId: uplineUser.id,
                    fromUserId: userId,
                    layer,
                    userVipLevel: vipLevel,
                    commissionRate,
                    betAmount,
                    commissionAmount,
                    betType,
                    betId,
                    calculationDate: new Date()
                });
                
                // Add to user balance
                await this.addCommissionToBalance(uplineUser.id, commissionAmount);
            }
        }
    }

    // Daily commission aggregation (scheduled at 12:30 IST)
    async aggregateDailyCommissions(date: Date): Promise<void> {
        this.logger.info(`Aggregating daily commissions for ${date.toISOString()}`);
        
        // Get all users who have commissions for this date
        const usersWithCommissions = await prisma.commission.groupBy({
            by: ['userId'],
            where: {
                calculationDate: {
                    gte: new Date(date.setHours(0, 0, 0, 0)),
                    lt: new Date(date.setHours(23, 59, 59, 999))
                }
            }
        });

        for (const { userId } of usersWithCommissions) {
            await this.createDailyCommissionSummary(userId, date);
        }
    }

    private async getUplineChain(userId: string, maxLevels: number): Promise<User[]> {
        // Recursively get upline users up to maxLevels
    }

    private async getCurrentVipLevel(userId: string): Promise<number> {
        // Get current VIP level from UserVipLevel table
    }

    private async getCommissionRate(vipLevel: number, layer: number): Promise<number> {
        // Get commission rate from CommissionRateConfig table
    }
}
```

### 2.2 Commission Scheduler

**Location**: `apps/engine/src/scheduler/commissionScheduler.ts`

```typescript
import cron, { ScheduledTask } from "node-cron";
import Logger from "@bcwin/logger";
import { CommissionCalculator } from "../services/commission/commissionCalculator";

export class CommissionScheduler {
    private commissionCalculator: CommissionCalculator;
    private task: ScheduledTask | null = null;
    private logger = new Logger("commission-scheduler");

    constructor() {
        this.commissionCalculator = new CommissionCalculator();
    }

    start(): void {
        this.logger.info("Starting Commission scheduler...");

        // Daily at 12:30 IST (07:00 UTC, accounting for IST = UTC+5:30)
        this.task = cron.schedule("0 30 7 * * *", async () => {
            try {
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                
                this.logger.info("Starting daily commission aggregation...");
                await this.commissionCalculator.aggregateDailyCommissions(yesterday);
                this.logger.info("Daily commission aggregation completed.");
            } catch (error) {
                this.logger.error("Error in commission aggregation:", error);
            }
        }, {
            timezone: "Asia/Kolkata"
        });

        this.task.start();
        this.logger.info("Commission scheduler started successfully.");
    }

    stop(): void {
        if (this.task) {
            this.task.stop();
            this.task = null;
        }
        this.logger.info("Commission scheduler stopped.");
    }
}
```

### 2.3 Integration with Bet Settlement

**Modify existing bet settlement services** (e.g., `apps/engine/src/services/wingo/betSettlement.ts`):

```typescript
import { CommissionCalculator } from "../commission/commissionCalculator";

export class BetSettlement {
    private commissionCalculator = new CommissionCalculator();

    // In existing settlement logic, after bet is settled:
    private async settleBet(bet: WingoBet, result: WingoBetResult): Promise<void> {
        // ... existing settlement logic ...

        // Calculate commission for this bet
        await this.commissionCalculator.calculateCommissionForBet(
            bet.id,
            "WINGO",
            bet.userId,
            bet.betAmount,
            bet.contractAmount
        );
    }
}
```

---

## 🎯 Phase 3: API Routes for Commission

### 3.1 Commission Routes

**Location**: `apps/api/src/routes/commission/index.ts`

```typescript
import { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { prisma } from "@bcwin/db";
import { authMiddleware } from "../../middleware/auth";

const app = new OpenAPIHono();

app.use("*", authMiddleware);

// Get daily commission
app.openapi(
    {
        method: "get",
        path: "/daily",
        summary: "Get daily commission summary",
        request: {
            query: z.object({
                date: z.string().optional(), // YYYY-MM-DD format
                page: z.string().optional(),
                limit: z.string().optional()
            })
        }
    },
    async (c) => {
        const user = c.get("user");
        const { date, page = "1", limit = "30" } = c.req.query();
        
        // Implementation for daily commission
    }
);

// Get direct team (Layer 1)
app.openapi(
    {
        method: "get",
        path: "/team/direct",
        summary: "Get direct team members and their contributions"
    },
    async (c) => {
        const user = c.get("user");
        
        // Get Layer 1 team members
        const directTeam = await prisma.user.findMany({
            where: { referredBy: user.referralCode },
            select: {
                id: true,
                username: true,
                createdAt: true,
                // Include betting and deposit stats
            }
        });
        
        return c.json({ success: true, data: directTeam });
    }
);

// Get indirect team (Layers 2-6)
app.openapi(
    {
        method: "get",
        path: "/team/indirect",
        summary: "Get indirect team members by layer"
    },
    async (c) => {
        const user = c.get("user");
        // Implementation for indirect team
    }
);

// Get commission breakdown by layer
app.openapi(
    {
        method: "get",
        path: "/breakdown",
        summary: "Get commission breakdown by layer"
    },
    async (c) => {
        const user = c.get("user");
        // Implementation for commission breakdown
    }
);

export default app;
```

### 3.2 VIP Level Routes

**Location**: `apps/api/src/routes/vip/index.ts`

```typescript
// Routes for VIP level information, requirements, and current status
```

---

## 📈 Phase 4: VIP Level Promotion System

### 4.1 VIP Level Calculator

**Location**: `apps/api/src/lib/vipCalculator.ts`

```typescript
import { prisma } from "@bcwin/db";
import Logger from "@bcwin/logger";

export class VipCalculator {
    private logger = new Logger("vip-calculator");

    // Calculate VIP level for a specific user
    async calculateUserVipLevel(userId: string): Promise<number> {
        // Get team metrics
        const teamMetrics = await this.getTeamMetrics(userId);
        
        // Get VIP requirements
        const vipRequirements = await prisma.vipLevelRequirement.findMany({
            orderBy: { level: 'desc' } // Start from highest level
        });

        // Find highest VIP level user qualifies for
        for (const requirement of vipRequirements) {
            if (
                teamMetrics.teamSize >= requirement.teamSize &&
                teamMetrics.teamBetting >= requirement.teamBetting &&
                teamMetrics.teamDeposit >= requirement.teamDeposit
            ) {
                return requirement.level;
            }
        }

        return 0; // Default VIP level
    }

    // Update VIP level for all users (scheduled daily)
    async updateAllUserVipLevels(): Promise<void> {
        this.logger.info("Starting VIP level calculation for all users...");

        // Get all users in batches
        const batchSize = 100;
        let skip = 0;
        let users: User[];

        do {
            users = await prisma.user.findMany({
                skip,
                take: batchSize,
                where: { isBanned: false }
            });

            for (const user of users) {
                await this.updateUserVipLevel(user.id);
            }

            skip += batchSize;
        } while (users.length === batchSize);

        this.logger.info("VIP level calculation completed for all users.");
    }

    private async updateUserVipLevel(userId: string): Promise<void> {
        const newVipLevel = await this.calculateUserVipLevel(userId);
        
        await prisma.userVipLevel.upsert({
            where: { userId },
            update: {
                currentLevel: newVipLevel,
                lastCalculatedAt: new Date()
            },
            create: {
                userId,
                currentLevel: newVipLevel,
                lastCalculatedAt: new Date()
            }
        });
    }

    private async getTeamMetrics(userId: string): Promise<TeamMetrics> {
        // Calculate real-time team metrics or get from cache
    }
}
```

### 4.2 VIP Level Scheduler

**Location**: `apps/engine/src/scheduler/vipLevelScheduler.ts`

```typescript
import cron, { ScheduledTask } from "node-cron";
import Logger from "@bcwin/logger";
import { VipCalculator } from "../../lib/vipCalculator";

export class VipLevelScheduler {
    private vipCalculator: VipCalculator;
    private task: ScheduledTask | null = null;
    private logger = new Logger("vip-level-scheduler");

    constructor() {
        this.vipCalculator = new VipCalculator();
    }

    start(): void {
        this.logger.info("Starting VIP Level scheduler...");

        // Daily at 2:00 AM IST (20:30 UTC previous day)
        this.task = cron.schedule("30 20 * * *", async () => {
            try {
                this.logger.info("Starting VIP level recalculation...");
                await this.vipCalculator.updateAllUserVipLevels();
                this.logger.info("VIP level recalculation completed.");
            } catch (error) {
                this.logger.error("Error in VIP level calculation:", error);
            }
        }, {
            timezone: "Asia/Kolkata"
        });

        this.task.start();
        this.logger.info("VIP Level scheduler started successfully.");
    }

    stop(): void {
        if (this.task) {
            this.task.stop();
            this.task = null;
        }
        this.logger.info("VIP Level scheduler stopped.");
    }
}
```

---

## 🔧 Phase 5: Data Population & Configuration

### 5.1 Seed Commission Rate Configuration

**Location**: `packages/db/seeds/commissionRates.ts`

```typescript
// Populate CommissionRateConfig table with data from promotion.md
// Populate VipLevelRequirement table with VIP requirements
```

### 5.2 Team Metrics Calculator

**Location**: `apps/api/src/lib/teamMetricsCalculator.ts`

```typescript
// Real-time calculation of team metrics
// Recursive team size, betting, and deposit calculation
// Caching strategy for performance
```

---

## 🚀 Phase 6: Integration & Deployment

### 6.1 Engine Service Integration

**Update**: `apps/engine/src/index.ts`

```typescript
import { CommissionScheduler } from "./scheduler/commissionScheduler";
import { VipLevelScheduler } from "./scheduler/vipLevelScheduler";

// Add to existing schedulers
const commissionScheduler = new CommissionScheduler();
const vipLevelScheduler = new VipLevelScheduler();

// Start schedulers
commissionScheduler.start();
vipLevelScheduler.start();

// Add to graceful shutdown
await Promise.all([
    // ... existing shutdowns ...
    commissionScheduler.stop(),
    vipLevelScheduler.stop(),
]);
```

### 6.2 API Service Integration

**Update**: `apps/api/src/registerRoutes.ts`

```typescript
import commissionRoutes from "./routes/commission";
import vipRoutes from "./routes/vip";

// Register new routes
app.route("/api/commission", commissionRoutes);
app.route("/api/vip", vipRoutes);
```

---

## 📊 Phase 7: Performance Optimization

### 7.1 Database Indexing
- Add appropriate indexes for fast queries
- Optimize for commission calculations and team metrics

### 7.2 Caching Strategy
- Cache VIP levels in Redis
- Cache team metrics for frequent access
- Implement cache invalidation strategies

### 7.3 Background Processing
- Queue heavy calculations
- Batch processing for large datasets

---

## 🧪 Phase 8: Testing & Validation

### 8.1 Unit Tests
- Commission calculation accuracy
- VIP level promotion logic
- Team metrics calculation

### 8.2 Integration Tests
- API endpoint functionality
- Scheduler execution
- Database consistency

### 8.3 Performance Tests
- Large dataset handling
- Concurrent user scenarios
- Scheduler performance under load

---

## 📋 Implementation Checklist

### Database & Schema
- [ ] Create commission-related tables
- [ ] Add user relations
- [ ] Create configuration tables
- [ ] Run database migrations
- [ ] Seed initial configuration data

### Commission System
- [ ] Implement CommissionCalculator service
- [ ] Create CommissionScheduler
- [ ] Integrate with existing bet settlement
- [ ] Test commission calculation accuracy

### API Development
- [ ] Create commission API routes
- [ ] Implement team management routes
- [ ] Add VIP level information routes
- [ ] Test API endpoints

### VIP System
- [ ] Implement VipCalculator
- [ ] Create VipLevelScheduler
- [ ] Test promotion logic
- [ ] Validate against requirements

### Integration
- [ ] Update engine service
- [ ] Update API service
- [ ] Test scheduler timing (IST timezone)
- [ ] Verify end-to-end functionality

### Performance & Monitoring
- [ ] Add database indexes
- [ ] Implement caching
- [ ] Set up monitoring
- [ ] Performance testing

---

## 🕐 Scheduler Timeline

| Time (IST) | Scheduler | Purpose |
|------------|-----------|---------|
| 02:00 AM | VIP Level Scheduler | Calculate and update VIP levels for all users |
| 12:30 PM | Commission Scheduler | Aggregate daily commissions and update summaries |

---

## 📈 Expected Performance Metrics

- **Commission Calculation**: Sub-second for individual bets
- **Daily Aggregation**: Complete within 10 minutes for 100K users
- **VIP Level Calculation**: Complete within 30 minutes for 100K users
- **API Response Time**: < 200ms for commission queries
- **Team Metrics**: < 500ms for team overview

This implementation plan provides a comprehensive roadmap for implementing the commission and VIP promotion system while maintaining the existing codebase architecture and practices.