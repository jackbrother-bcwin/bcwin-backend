# Implementation Plan

Based on the PDF requirements, this document outlines all features that need to be implemented in the bcwin project.

---

## 1. Illegal Bet Monitor Dashboard

### 1.1 Database Schema Updates

**Table: `IllegalBet` (Already exists)**
- ✅ Already has: `id`, `userId`, `betAmount`, `betGame`, `betType`, `createdAt`, `updatedAt`
- No changes needed for current requirements

### 1.2 Backend API Endpoints

#### 1.2.1 Dashboard Statistics Endpoint (Combined)
- **Path**: `GET /api/v1/admin/illegal-bets/statistics`
- **Description**: Get all dashboard statistics including cards, violations by game, and risk analysis
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "cards": {
        "totalViolations": 150,
        "activeViolators": 25,
        "lockedAccounts": 10,
        "violationRate": 6.0
      },
      "violationsByGame": {
        "wingo": 45,
        "k3": 38,
        "5d": 42,
        "trx": 25,
        "moto": 0
      },
      "riskLevelAnalysis": {
        "lowRisk": 60,      // percentage
        "mediumRisk": 30,   // percentage
        "highRisk": 10      // percentage
      }
    }
  }
  ```
- **Logic**:
  - **Cards**:
    - `totalViolations`: Count of all `IllegalBet` records
    - `activeViolators`: Count of distinct users with illegal bets in last 24 hours
    - `lockedAccounts`: Count of users who are banned (`isBanned = true`) AND have illegal bets
    - `violationRate`: Average illegal bets per violating user
  - **Violations by Game**: Group count by `betGame` field
  - **Risk Level Analysis**:
    - **Low Risk**: 1-3 violations (percentage)
    - **Medium Risk**: 4-7 violations (percentage)
    - **High Risk**: 8+ violations (percentage)

#### 1.2.2 Update Existing Illegal Bets List Endpoint
- **Path**: `GET /api/v1/admin/illegal-bets`
- **Current State**: ✅ Already exists
- **Enhancement Needed**: Add filters
  - `startDate`: Filter by date range start
  - `endDate`: Filter by date range end
  - `minBetAmount`: Minimum bet amount filter
  - `serialNumber`: Filter by user serial number
- **Updated Response**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "uuid",
        "userSerialNumber": 12345,
        "userId": "uuid",
        "username": "john_doe",
        "betAmount": 1000,
        "betGame": "wingo",
        "betType": "RED",
        "createdAt": "2025-01-03T10:30:00Z"
      }
    ],
    "total": 100,
    "currentPage": 1,
    "totalPages": 10
  }
  ```

---

## 2. IP Intelligence Dashboard

### 2.1 Database Schema Updates

**New Table: `IpActivity`**
```prisma
model IpActivity {
  id           String   @id @default(uuid())
  ip           String
  userId       String?
  activityType IpActivityType
  metadata     Json?    // Store additional context
  createdAt    DateTime @default(now())
  
  user         User?    @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@index([ip])
  @@index([userId])
  @@index([activityType])
  @@index([createdAt])
  @@index([ip, activityType])
}

enum IpActivityType {
  LOGIN
  REGISTER
  BETTING
  DEPOSIT
  WITHDRAWAL
}
```

**Update Table: `Ip`**
- Add new field: `riskLevel` (LOW, MEDIUM, HIGH)
- Add new field: `lastActivityAt` (DateTime)
```prisma
model Ip {
  id            String    @id @default(uuid())
  ip            String    @unique
  isBlacklisted Boolean   @default(false)
  reason        String?
  riskLevel     RiskLevel @default(LOW)
  lastActivityAt DateTime? 
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  @@index([ip])
  @@index([riskLevel])
}

enum RiskLevel {
  LOW
  MEDIUM
  HIGH
}
```

### 2.2 Backend API Endpoints

#### 2.2.1 IP Dashboard Statistics Endpoint
- **Path**: `GET /api/v1/admin/ip/statistics`
- **Description**: Get IP intelligence dashboard card statistics
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "totalActiveIPs": 1250,
      "highRiskIPs": 45,
      "blockedIPs": 12,
      "activeUsersPercentage": 68.5
    }
  }
  ```
- **Logic**:
  - `totalActiveIPs`: Count of IPs with activity in last 7 days
  - `highRiskIPs`: Count of IPs with `riskLevel = HIGH`
  - `blockedIPs`: Count of IPs with `isBlacklisted = true`
  - `activeUsersPercentage`: (Users active in last 24h / Total users) * 100

#### 2.2.2 Update Existing IP List Endpoint (Add Enhanced Filters)
- **Path**: `GET /api/v1/admin/ip/list`
- **Current State**: ✅ Already exists (`apps/api/src/routes/admin/ip.ts`)
- **Enhancement Needed**: Add new filters and include activity data
- **Query Parameters** (Add to existing):
  - `page`: Page number (default: 1) - ✅ exists
  - `limit`: Items per page (default: 20) - ✅ exists
  - `search`: Search by IP address - ✅ exists
  - `isBlacklisted`: Filter by blacklist status - ✅ exists
  - `riskLevel`: Filter by risk level (LOW, MEDIUM, HIGH) - ⚠️ ADD NEW
  - `activityType`: Filter by activity type (LOGIN, REGISTER, BETTING, DEPOSIT, WITHDRAWAL) - ⚠️ ADD NEW
  - `timeRange`: Filter by time range (TODAY, THIS_WEEK, THIS_MONTH) - ⚠️ ADD NEW
- **Updated Response**:
  ```json
  {
    "success": true,
    "ips": [
      {
        "id": "uuid",
        "ip": "192.168.1.1",
        "riskLevel": "MEDIUM",
        "isBlacklisted": false,
        "reason": null,
        "userCount": 3,
        "recentActivities": [
          {
            "type": "LOGIN",
            "count": 15,
            "lastOccurrence": "2025-01-03T10:30:00Z"
          }
        ],
        "lastActivityAt": "2025-01-03T10:30:00Z",
        "createdAt": "2025-01-01T10:30:00Z",
        "updatedAt": "2025-01-03T10:30:00Z"
      }
    ],
    "total": 100,
    "currentPage": 1,
    "totalPages": 5
  }
  ```

### 2.3 IP Activity Tracking Implementation

**Locations to Add IP Activity Logging**:

1. **Login** (`apps/api/src/routes/auth.ts`)
   - Log `IpActivity` with type `LOGIN` on successful login

2. **Registration** (`apps/api/src/routes/auth.ts`)
   - Log `IpActivity` with type `REGISTER` on user registration

3. **Betting** (All game bet routes)
   - `apps/api/src/routes/wingo/bets.ts`
   - `apps/api/src/routes/k3/bets.ts`
   - `apps/api/src/routes/5d/bets.ts`
   - `apps/api/src/routes/trxwingo/bets.ts`
   - `apps/api/src/routes/moto/bets.ts`
   - Log `IpActivity` with type `BETTING` on bet placement

4. **Deposit** (`apps/api/src/routes/payment/payment.ts`)
   - Log `IpActivity` with type `DEPOSIT` on deposit creation

5. **Withdrawal** (`apps/api/src/routes/payment/payment.ts`)
   - Log `IpActivity` with type `WITHDRAWAL` on withdrawal creation

### 2.4 Automatic Risk Level Calculation

**Create a background job** to periodically calculate IP risk levels:

- **File**: `apps/engine/src/jobs/calculateIpRiskLevel.ts`
- **Schedule**: Run every hour
- **Logic**:
  - **LOW**: 1-2 users from IP, normal activity patterns
  - **MEDIUM**: 3-5 users from IP, or unusual activity spikes
  - **HIGH**: 6+ users from IP, or multiple banned users, or suspicious patterns

---

## 3. API Endpoint Updates

### 3.1 Update User Details Endpoint (Add Commission Details)

- **Path**: `GET /api/v1/admin/users/:id`
- **Current State**: ✅ Already exists (`apps/api/src/routes/admin/users/stats.ts`)
- **Enhancement Needed**: Add commission details to response

**Updated Response Schema** (Add to existing response):
```json
{
  "success": true,
  "user": {
    // ... existing fields ...
    "vipLevel": 5,
    "totalCommission": 5000.50
  }
}
```

**Implementation**:
- File: `apps/api/src/routes/admin/users/stats.ts`
- Update response to include:
  - `vipLevel`: From `UserVipLevel.currentLevel`
  - `totalCommission`: Sum from `DailyCommissionSummary` table for the user
- Query `UserVipLevel` and `DailyCommissionSummary` tables
- Add to existing user stats calculation

### 3.2 Update User List Endpoint (Add Role-Based Filter)

- **Path**: `GET /api/v1/admin/users/list`
- **Current State**: ✅ Already exists (`apps/api/src/routes/admin/users/list.ts`)
- **Enhancement Needed**: Add `role` filter parameter

**Query Parameters** (Add to existing):
- `role`: Filter by user role (USER, ADMIN, SUB_ADMIN, AGENT)

**Implementation**:
- File: `apps/api/src/routes/admin/users/list.ts`
- Update `GetUsersQuerySchema` in `apps/api/src/schemas/adminUsers.ts`:
  ```typescript
  role: z.enum(["USER", "ADMIN", "SUB_ADMIN", "AGENT"]).optional()
  ```
- Add role filter to the `where` clause in the query
- Update cache key to include role parameter

---

## 4. Frontend Implementation Requirements

### 4.1 Illegal Bet Monitor Dashboard Page

**Route**: `/admin/illegal-bets-monitor`

**Components to Create**:
1. **StatisticsCards.tsx**
   - Display: Total Violations, Active Violators, Locked Accounts, Violation Rate
   - Fetch from: `/api/v1/admin/illegal-bets/statistics`

2. **ViolationsByGameChart.tsx**
   - Chart type: Bar chart or Pie chart
   - Display violations for: Wingo, K3, 5D, Trx, Moto
   - Fetch from: `/api/v1/admin/illegal-bets/statistics` (violationsByGame section)

3. **RiskLevelAnalysisChart.tsx**
   - Chart type: Donut chart or Pie chart
   - Display: Low/Medium/High risk percentages
   - Fetch from: `/api/v1/admin/illegal-bets/statistics` (riskLevelAnalysis section)

4. **IllegalBetsList.tsx**
   - Data table with filters:
     - Date range picker
     - User serial number input
     - Minimum bet amount input
   - Columns: Serial Number, Username, Bet Amount, Game, Bet Type, Date
   - Fetch from: `/api/v1/admin/illegal-bets` (enhanced)

### 4.2 IP Intelligence Dashboard Page

**Route**: `/admin/ip-intelligence`

**Components to Create**:
1. **IpStatisticsCards.tsx**
   - Display: Total Active IPs, High Risk IPs, Blocked IPs, Active Users %
   - Fetch from: `/api/v1/admin/ip/statistics`

2. **IpActivityList.tsx**
   - Data table with filters:
     - Risk level dropdown (Low/Medium/High)
     - Activity type dropdown (Login/Register/Betting/Deposit/Withdrawal)
     - Time range selector (Today/This Week/This Month)
     - IP search input
   - Columns: IP Address, Risk Level, User Count, Recent Activities, Last Activity
   - Actions: View Details, Block/Unblock
   - Fetch from: `/api/v1/admin/ip/list` (enhanced with new filters)

3. **IpDetailsModal.tsx**
   - Show detailed IP information
   - List all users using the IP
   - Show activity timeline
   - Actions: Block/Unblock IP

### 4.3 User Management Enhancements

**Existing Page**: `/admin/users`

**Updates Needed**:
1. **UserListFilters.tsx**
   - Add role filter dropdown (USER, ADMIN, SUB_ADMIN, AGENT)

2. **UserDetailsPage.tsx** (for route `/admin/users/:id`)
   - Add **VIP & Commission Section**:
     - Display user VIP level
     - Display total commission earned

---

## 5. Implementation Checklist

### Phase 1: Database & Schema
- [ ] Create migration for `IpActivity` table
- [ ] Create migration to add `riskLevel` and `lastActivityAt` to `Ip` table
- [ ] Create `RiskLevel` and `IpActivityType` enums
- [ ] Run migrations

### Phase 2: Backend - Illegal Bet Monitor
- [ ] Create `apps/api/src/routes/admin/illegalBets/statistics.ts` (combined endpoint)
- [ ] Update `apps/api/src/routes/admin/illegalBets.ts` with new filters (date range, min bet amount, serial number)
- [ ] Register statistics route in `apps/api/src/routes/admin/index.ts`
- [ ] Add cache keys in `packages/cache/src/keys.ts`

### Phase 3: Backend - IP Intelligence
- [ ] Create `apps/api/src/routes/admin/ip/statistics.ts`
- [ ] Update `apps/api/src/routes/admin/ip.ts` - enhance list endpoint with new filters (riskLevel, activityType, timeRange)
- [ ] Update IP list response to include `riskLevel`, `lastActivityAt`, and `recentActivities`
- [ ] Add IP activity logging helper function
- [ ] Implement IP activity tracking in:
  - [ ] Auth routes (login, register)
  - [ ] Betting routes (all games)
  - [ ] Payment routes (deposit, withdrawal)
- [ ] Create `apps/engine/src/jobs/calculateIpRiskLevel.ts`
- [ ] Add IP risk calculation job to scheduler

### Phase 4: Backend - User API Updates
- [ ] Update `apps/api/src/routes/admin/users/stats.ts` - add vipLevel and totalCommission
- [ ] Update `apps/api/src/schemas/adminUsers.ts` - add vipLevel and totalCommission to schema
- [ ] Update `apps/api/src/routes/admin/users/list.ts` - add role filter
- [ ] Update cache invalidation logic

### Phase 5: Frontend - Illegal Bet Monitor
- [ ] Create `pages/admin/illegal-bets-monitor.tsx`
- [ ] Create `components/admin/illegal-bets/StatisticsCards.tsx`
- [ ] Create `components/admin/illegal-bets/ViolationsByGameChart.tsx`
- [ ] Create `components/admin/illegal-bets/RiskLevelAnalysisChart.tsx`
- [ ] Create `components/admin/illegal-bets/IllegalBetsList.tsx`
- [ ] Add API hooks/services for illegal bet endpoints
- [ ] Add route to navigation menu

### Phase 6: Frontend - IP Intelligence
- [ ] Create `pages/admin/ip-intelligence.tsx`
- [ ] Create `components/admin/ip/IpStatisticsCards.tsx`
- [ ] Create `components/admin/ip/IpActivityList.tsx`
- [ ] Create `components/admin/ip/IpDetailsModal.tsx`
- [ ] Add API hooks/services for IP endpoints
- [ ] Add route to navigation menu

### Phase 7: Frontend - User Management Updates
- [ ] Update user list filters to include role filter
- [ ] Update user details page to show VIP level and total commission
- [ ] Update API hooks to fetch new user details with vipLevel and totalCommission

### Phase 8: Testing & Optimization
- [ ] Test all new API endpoints
- [ ] Test IP activity tracking
- [ ] Test IP risk level calculation job
- [ ] Verify cache invalidation
- [ ] Test all frontend components
- [ ] Performance testing for large datasets
- [ ] Add API documentation (OpenAPI/Swagger)

---

## 6. Technical Notes

### 6.1 Caching Strategy
- **Illegal Bet Statistics**: Cache for 5 minutes
- **IP Statistics**: Cache for 5 minutes
- **IP List**: Cache for 3 minutes
- **User Details with Commission**: Cache for 5 minutes
- Invalidate caches when:
  - New illegal bet is detected
  - IP is blocked/unblocked
  - Risk level is updated
  - User commission is updated

### 6.2 Performance Considerations
- Add database indexes for:
  - `IpActivity.ip`, `IpActivity.activityType`, `IpActivity.createdAt`
  - `Ip.riskLevel`, `Ip.lastActivityAt`
  - `IllegalBet.createdAt`, `IllegalBet.betGame`
- Use aggregation pipelines for statistics endpoints
- Implement pagination for all list endpoints
- Consider using materialized views for complex queries

### 6.3 Security Considerations
- Ensure IP activity logging doesn't expose sensitive data
- Add admin authentication middleware to all new endpoints
- Implement rate limiting on IP tracking endpoints
- Add audit logging for IP blocking/unblocking actions

---

## 7. API Endpoints Summary

### Illegal Bet Monitor APIs
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/admin/illegal-bets/statistics` | Combined dashboard statistics (cards, by-game, risk analysis) |
| GET | `/api/v1/admin/illegal-bets` | List illegal bets (enhanced with filters) |

### IP Intelligence APIs
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/admin/ip/statistics` | IP dashboard statistics |
| GET | `/api/v1/admin/ip/list` | IP list with enhanced filters (riskLevel, activityType, timeRange) |
| GET | `/api/v1/admin/ip/:ip` | IP details (already exists) |
| POST | `/api/v1/admin/ip/:ip/blacklist` | Blacklist IP (already exists) |
| POST | `/api/v1/admin/ip/:ip/whitelist` | Whitelist IP (already exists) |

### User Management APIs (Updated)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/admin/users/:id` | Get user details (add vipLevel & totalCommission) |
| GET | `/api/v1/admin/users/list` | List users (add role filter) |

---

## 8. Estimated Timeline

- **Phase 1 (Database)**: 1 day
- **Phase 2 (Illegal Bet Backend)**: 1-2 days (simplified - one combined endpoint)
- **Phase 3 (IP Intelligence Backend)**: 2-3 days (simplified - enhanced existing endpoint)
- **Phase 4 (User API Updates)**: 1 day (simplified - only vipLevel & totalCommission)
- **Phase 5 (Illegal Bet Frontend)**: 3-4 days
- **Phase 6 (IP Intelligence Frontend)**: 3-4 days
- **Phase 7 (User Management Frontend)**: 1 day (simplified)
- **Phase 8 (Testing & Polish)**: 2-3 days

**Total Estimated Time**: 14-22 days

---

## 9. Dependencies & Requirements

### Backend Dependencies (Already in use)
- Hono (API framework)
- Prisma (ORM)
- Zod (Schema validation)
- Redis (Caching via `@bcwin/cache`)

### Frontend Dependencies (To be determined based on existing stack)
- Chart library for visualization (e.g., Recharts, Chart.js, ApexCharts)
- Date picker library for date range filters
- Data table library (if not already present)

### Infrastructure
- Database migration tool (Prisma)
- Cron job scheduler for IP risk calculation (probably already exists in `apps/engine`)

---

## 10. Future Enhancements (Optional)

- Real-time alerts for high-risk IPs
- ML-based IP risk scoring
- Geolocation tracking for IPs
- Advanced illegal bet pattern detection
- Export functionality for reports
- Email notifications for suspicious activities
- IP reputation API integration
- Historical trend analysis

