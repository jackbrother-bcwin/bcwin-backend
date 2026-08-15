# Caching Implementation Guide

## Overview
This document provides a comprehensive guide on the custom caching system used in the bcwin project and identifies routes where caching can be implemented to improve performance.

---

## Custom Cache Package

### Location
`packages/cache/`

### Key Components

#### 1. Cache Class (`packages/cache/index.ts`)
The main caching interface built on top of Redis with the following features:

**Features:**
- **Circuit Breaker Pattern**: Automatically opens circuit for 60 seconds on timeout to prevent cascading failures
- **Timeout Protection**: All operations have a 200ms timeout by default
- **Graceful Degradation**: Returns `null` on cache failures, allowing app to continue
- **Environment Control**: Can be disabled via `DISABLE_CACHE` environment variable
- **Hit/Miss Logging**: Tracks cache performance

**Methods:**
```typescript
Cache.set<T>(key: string, value: T, ttlSeconds: number): Promise<void>
Cache.get<T>(key: string): Promise<T | null>
Cache.hset<T>(key: string, field: string, value: T, ttlSeconds?: number): Promise<void>
Cache.hget<T>(key: string, field: string): Promise<T | null>
Cache.expire(key: string, ttlSeconds: number): Promise<void>
Cache.del(key: string): Promise<number>
Cache.ping(): Promise<boolean>
```

#### 2. CacheKey Class (`packages/cache/index.ts`)
Provides standardized cache key generation to avoid key collisions:

**Existing Keys:**
```typescript
CacheKey.bank(userId: string)              // User bank details
CacheKey.fiveDBets(userId: string)         // 5D game bets
CacheKey.k3Bets(userId: string)            // K3 game bets
CacheKey.motoBets(userId: string)          // Moto game bets
CacheKey.wingoBets(userId: string)         // Wingo game bets
CacheKey.trxWingoBets(userId: string)      // TRX Wingo game bets
CacheKey.adminOverview                     // Admin dashboard overview
CacheKey.adminGifts                        // Admin gifts list
```

#### 3. ResultSetter Class (`packages/cache/resultSetter.ts`)
Specialized caching for admin-set game results with 15-minute TTL.

---

## Currently Implemented Caching

### 1. Bank Details Route (`apps/api/src/routes/payment/bank.ts`)

**Implementation:**
- **GET /bank**: Caches bank details for 2 days (48 hours)
- **POST /bank**: Updates cache after creating bank details
- **PATCH /bank**: Updates cache after modifying bank details

**Pattern:**
```typescript
// Read from cache
const cachedBankDetails = await Cache.get<BankReturn>(CacheKey.bank(user.id));
if (cachedBankDetails) {
    return c.json({ success: true, data: cachedBankDetails }, HTTP_STATUS.OK);
}

// Fetch from DB
const bankDetails = await prisma.bank.findUnique({ where: { userId: user.id } });

// Set cache
await Cache.set<BankReturn>(CacheKey.bank(userId), bankDetails, 2 * 24 * 60 * 60);
```

**Cache Invalidation:** Cache is updated (not deleted) on POST and PATCH operations.

**TTL:** 2 days (172,800 seconds)

---

### 2. Admin Overview Route (`apps/api/src/routes/admin/overview.ts`)

**Implementation:**
- **GET /overview**: Caches complex aggregated statistics for 2 minutes

**Pattern:**
```typescript
// Check cache
const cachedData = await Cache.get<AdminOverviewData>(CacheKey.adminOverview);
if (cachedData) {
    return c.json({ success: true, data: cachedData }, HTTP_STATUS.OK);
}

// Calculate expensive aggregations (30+ database queries)
const data = await calculateOverview();

// Cache result
await Cache.set<AdminOverviewData>(CacheKey.adminOverview, data, 60 * 2);
```

**Why It Works:**
- Aggregates data from multiple tables (users, deposits, withdrawals, bets)
- Runs 30+ parallel queries
- Data is acceptable to be slightly stale (2 minutes)
- Drastically reduces database load

**TTL:** 2 minutes (120 seconds)

---

### 3. Game Bet Routes (Wingo, 5D, K3, Moto, TRX Wingo)

**Example:** `apps/api/src/routes/wingo/bets.ts`

**Implementation:**
- **GET /bets**: Uses hash-based caching for paginated bet history
- **POST /bet**: Deletes user's bet cache on new bet placement

**Pattern (Hash-based for pagination):**
```typescript
const mainCacheKey = CacheKey.wingoBets(user.id);
const fieldKey = `p:${periodId || "all"}-d:${duration || "all"}-l:${limit}-o:${offset}`;

// Check hash cache
const cachedData = await Cache.hget<BetData>(mainCacheKey, fieldKey);
if (cachedData) {
    return c.json({ success: true, ...cachedData }, HTTP_STATUS.OK);
}

// Fetch from DB
const bets = await prisma.wingoBet.findMany({ ... });

// Cache with hash
await Cache.hset(mainCacheKey, fieldKey, result, 60 * 60);
```

**Cache Invalidation:**
```typescript
// On new bet placement
await Cache.del(CacheKey.wingoBets(user.id));
```

**Why Hash Caching:**
- Different pagination parameters create different cache entries
- Allows granular caching per query parameter combination
- More efficient than caching entire datasets

**TTL:** 1 hour (3,600 seconds)

---

## Routes That Should Implement Caching

### High Priority (Frequent Reads, Expensive Queries)

#### 1. VIP Routes (`apps/api/src/routes/user/vip.ts`)

**Route: GET /vip/status**
- **Why**: Queries multiple tables (UserVipLevel, TeamMetrics, VipLevelRequirement, CommissionRateConfig)
- **Complexity**: 5+ database queries per request
- **Read Pattern**: Frequently read by users checking their VIP progress
- **Recommended Cache Duration**: 5-10 minutes
- **Cache Key**: `CacheKey.vipStatus(userId: string)`

**Implementation:**
```typescript
// Add to CacheKey class
static vipStatus = (userId: string) => `user:${userId}:vip-status`;

// In route handler
const cachedVipStatus = await Cache.get<VipStatusData>(CacheKey.vipStatus(user.id));
if (cachedVipStatus) {
    return c.json({ success: true, data: cachedVipStatus }, HTTP_STATUS.OK);
}

// ... existing query logic ...

await Cache.set(CacheKey.vipStatus(user.id), data, 60 * 5); // 5 minutes
```

**Invalidation:** Update cache when VIP level calculation runs (background job).

---

**Route: GET /vip/requirements**
- **Why**: Static configuration data, rarely changes
- **Complexity**: Single table scan
- **Read Pattern**: Read by all users viewing VIP levels
- **Recommended Cache Duration**: 1 hour or more
- **Cache Key**: `CacheKey.vipRequirements` (global)

**Implementation:**
```typescript
// Add to CacheKey class
static vipRequirements = "config:vip-requirements";

// In route handler
const cachedRequirements = await Cache.get<VipRequirement[]>(CacheKey.vipRequirements);
if (cachedRequirements) {
    return c.json({ success: true, data: cachedRequirements }, HTTP_STATUS.OK);
}

const requirements = await prisma.vipLevelRequirement.findMany({ ... });
await Cache.set(CacheKey.vipRequirements, data, 60 * 60); // 1 hour
```

**Invalidation:** Clear cache when admin updates VIP requirements.

---

**Route: GET /vip/commission-rates**
- **Why**: Configuration data, changes very rarely
- **Recommended Cache Duration**: 1 hour
- **Cache Key**: `CacheKey.commissionRates` (global)

---

#### 2. Team Routes (`apps/api/src/routes/user/team.ts`)

**Route: GET /team/members**
- **Why**:
  - Recursive query to fetch up to 6 layers of referrals
  - For each member: 7 aggregation queries (5 bet tables, deposits, commissions)
  - Extremely database-intensive for users with large teams
- **Complexity**: O(n * 7) queries where n = number of team members
- **Recommended Cache Duration**: 10-15 minutes
- **Cache Key Pattern**: Hash-based like bets
  - Main Key: `CacheKey.teamMembers(userId: string)`
  - Field Key: `layer:${layer || "all"}-page:${page}-limit:${limit}`

**Implementation:**
```typescript
// Add to CacheKey class
static teamMembers = (userId: string) => `user:${userId}:team-members`;

// In route handler
const mainCacheKey = CacheKey.teamMembers(user.id);
const fieldKey = `layer:${layer || "all"}-page:${page}-limit:${limit}`;

const cachedData = await Cache.hget<TeamMembersData>(mainCacheKey, fieldKey);
if (cachedData) {
    return c.json({ success: true, ...cachedData }, HTTP_STATUS.OK);
}

// ... existing query logic ...

await Cache.hset(mainCacheKey, fieldKey, result, 60 * 10); // 10 minutes
```

**Invalidation:**
- let TTL expire (acceptable staleness for this data)

---

**Route: GET /team/overview**
- **Why**: Already uses TeamMetrics table as a cache layer, but Redis caching would help further
- **Note**: Currently caches in database with 1-hour staleness check
- **Recommended**: Add Redis caching on top of TeamMetrics
- **Cache Duration**: 5 minutes
- **Cache Key**: `CacheKey.teamOverview(userId: string)`

**Implementation:**
```typescript
// Add to CacheKey class
static teamOverview = (userId: string) => `user:${userId}:team-overview`;

// In route handler (before TeamMetrics query)
const cachedOverview = await Cache.get<TeamOverviewData>(CacheKey.teamOverview(user.id));
if (cachedOverview) {
    return c.json({ success: true, data: cachedOverview }, HTTP_STATUS.OK);
}

// ... existing TeamMetrics logic ...

await Cache.set(CacheKey.teamOverview(user.id), finalData, 60 * 5); // 5 minutes
```

---

#### 3. Transaction Routes (`apps/api/src/routes/user/transaction.ts`)

**Route: GET /deposits**
- **Why**: Historical data, rarely changes once created
- **Complexity**: Paginated queries with date filtering
- **Recommended Cache Duration**: 5 minutes
- **Cache Key Pattern**: Hash-based
  - Main Key: `CacheKey.userDeposits(userId: string)`
  - Field Key: `status:${status || "all"}-start:${startDate || "none"}-end:${endDate || "none"}-page:${page}-limit:${limit}`

**Implementation:**
```typescript
// Add to CacheKey class
static userDeposits = (userId: string) => `user:${userId}:deposits`;

// In route handler
const mainCacheKey = CacheKey.userDeposits(user.id);
const fieldKey = `status:${status || "all"}-start:${startDate || "none"}-end:${endDate || "none"}-page:${page}-limit:${limit}`;

const cachedData = await Cache.hget<DepositsData>(mainCacheKey, fieldKey);
if (cachedData) {
    return c.json({ success: true, ...cachedData }, HTTP_STATUS.OK);
}

// ... existing query logic ...

await Cache.hset(mainCacheKey, fieldKey, result, 60 * 5); // 5 minutes
```

**Invalidation:**
- Delete cache when new deposit is created or status changes
- Target specific user: `await Cache.del(CacheKey.userDeposits(userId))`

---

**Route: GET /withdrawals**
- **Why**: Similar to deposits, historical data
- **Recommended Cache Duration**: 5 minutes
- **Cache Key Pattern**: Hash-based like deposits
  - Main Key: `CacheKey.userWithdrawals(userId: string)`

---

#### 4. Commission Routes

**Route: GET /commission/daily** (`apps/api/src/routes/user/commission/daily.ts`)
- **Why**:
  - Historical summary data from DailyCommissionSummary table
  - Data doesn't change once calculated for past dates
  - Perfect candidate for caching
- **Recommended Cache Duration**: 15-30 minutes
- **Cache Key Pattern**: Hash-based
  - Main Key: `CacheKey.dailyCommission(userId: string)`
  - Field Key: `date:${date || "all"}-page:${page}-limit:${limit}`

**Implementation:**
```typescript
// Add to CacheKey class
static dailyCommission = (userId: string) => `user:${userId}:daily-commission`;

// In route handler
const mainCacheKey = CacheKey.dailyCommission(user.id);
const fieldKey = `date:${date || "all"}-page:${page}-limit:${limit}`;

const cachedData = await Cache.hget<DailyCommissionData>(mainCacheKey, fieldKey);
if (cachedData) {
    return c.json({ success: true, ...cachedData }, HTTP_STATUS.OK);
}

// ... existing query logic ...

await Cache.hset(mainCacheKey, fieldKey, result, 60 * 15); // 15 minutes
```

---

**Route: GET /commission/breakdown** (`apps/api/src/routes/user/commission/breakdown.ts`)
- **Why**:
  - Fetches up to 100 commission records with joins
  - Calculates summary statistics
- **Recommended Cache Duration**: 10 minutes
- **Cache Key Pattern**: Hash-based
  - Main Key: `CacheKey.commissionBreakdown(userId: string)`
  - Field Key: `start:${startDate || "none"}-end:${endDate || "none"}-layer:${layer || "all"}`

---

### Medium Priority (Less Frequent or Simpler Queries)

#### 5. Period Routes (Wingo, 5D, K3, Moto, TRX Wingo)

**Example: GET /wingo/periods** (`apps/api/src/routes/wingo/periods.ts`)
- **Why**:
  - Frequently accessed to get current active period
  - Current period changes every few minutes (30s, 1min, 3min, 5min)
- **Recommended Cache Duration**: 5-10 seconds for current period, 1 hour for historical
- **Cache Strategy**: Two-tier caching
  - Short cache for active period
  - Long cache for historical periods list

**Implementation:**
```typescript
// Add to CacheKey class
static wingoPeriods = (duration?: number) =>
    `game:wingo:periods${duration ? `:${duration}` : ""}`;
static wingoCurrentPeriod = (duration?: number) =>
    `game:wingo:current-period${duration ? `:${duration}` : ""}`;

// In route handler
// Cache historical periods (longer TTL)
const cachedPeriods = await Cache.get<Period[]>(
    CacheKey.wingoPeriods(duration)
);

// Cache current period separately (shorter TTL)
const cachedCurrentPeriod = await Cache.get<Period | null>(
    CacheKey.wingoCurrentPeriod(duration)
);

if (cachedPeriods && cachedCurrentPeriod !== undefined) {
    return c.json({
        success: true,
        periods: cachedPeriods,
        currentPeriod: cachedCurrentPeriod
    }, HTTP_STATUS.OK);
}

// ... fetch from DB ...

await Cache.set(CacheKey.wingoPeriods(duration), periods, 60 * 60); // 1 hour
await Cache.set(CacheKey.wingoCurrentPeriod(duration), currentPeriod, 10); // 10 seconds
```

**Apply same pattern to:**
- 5D periods
- K3 periods
- Moto periods
- TRX Wingo periods

---

#### 6. Result Routes (Wingo, 5D, K3, Moto, TRX Wingo)

**Example: GET /wingo/results** (`apps/api/src/routes/wingo/results.ts`)
- **Why**:
  - Historical results don't change once resolved
  - Includes user bet data for each period
  - Frequently accessed
- **Recommended Cache Duration**: 30 minutes
- **Cache Key Pattern**: Hash-based per user
  - Main Key: `CacheKey.wingoResults(userId: string)`
  - Field Key: `duration:${duration || "all"}-limit:${limit}`

**Implementation:**
```typescript
// Add to CacheKey class
static wingoResults = (userId: string) => `user:${userId}:wingo-results`;

// In route handler
const mainCacheKey = CacheKey.wingoResults(user.id);
const fieldKey = `duration:${duration || "all"}-limit:${limit}`;

const cachedData = await Cache.hget<ResultsData>(mainCacheKey, fieldKey);
if (cachedData) {
    return c.json({ success: true, results: cachedData }, HTTP_STATUS.OK);
}

// ... query logic ...

await Cache.hset(mainCacheKey, fieldKey, results, 60 * 30); // 30 minutes
```

**Invalidation:** Clear user's cache when new bet result is processed for them.

---

**Route: GET /wingo/results/{periodId}**
- **Why**: Single resolved period result, completely static
- **Recommended Cache Duration**: 24 hours or more
- **Cache Key**: `CacheKey.wingoSingleResult(userId: string, periodId: string)`

**Implementation:**
```typescript
// Add to CacheKey class
static wingoSingleResult = (userId: string, periodId: string) =>
    `user:${userId}:wingo-result:${periodId}`;

const cachedResult = await Cache.get<ResultData>(
    CacheKey.wingoSingleResult(user.id, periodId)
);
if (cachedResult) {
    return c.json({ success: true, result: cachedResult }, HTTP_STATUS.OK);
}

// ... query logic ...

await Cache.set(
    CacheKey.wingoSingleResult(user.id, periodId),
    result,
    60 * 60 * 24 // 24 hours
);
```

---

#### 7. Admin Gift Routes (`apps/api/src/routes/admin/gift.ts`)

**Route: POST /admin/gifts** (should be GET based on implementation)
- **Why**: Paginated list of gifts, changes infrequently
- **Recommended Cache Duration**: 5 minutes
- **Cache Key Pattern**: Hash-based
  - Main Key: `CacheKey.adminGifts`
  - Field Key: `page:${page}-limit:${limit}`

**Implementation:**
```typescript
const fieldKey = `page:${page}-limit:${limit}`;

const cachedData = await Cache.hget<GiftsData>(CacheKey.adminGifts, fieldKey);
if (cachedData) {
    return c.json({ success: true, ...cachedData }, HTTP_STATUS.OK);
}

// ... query logic ...

await Cache.hset(CacheKey.adminGifts, fieldKey, result, 60 * 5); // 5 minutes
```

**Invalidation:** Delete `CacheKey.adminGifts` when new gift is created.

---

### Low Priority (Simple Queries or Write-Heavy)

#### 8. User Route (`apps/api/src/routes/user/user.ts`)

**Route: GET /user**
- **Why**: User data already loaded in middleware via `c.get("user")`
- **Note**: This data comes from middleware which likely loads it fresh from DB
- **Recommendation**:
  - Cache at middleware level instead
  - Or cache only if user data changes infrequently
- **If implementing**: Cache duration 5 minutes

---

## Cache Invalidation Strategies

### 1. **Time-Based Expiration (TTL)**
Most common and simplest strategy. Data automatically expires after TTL.

**When to use:**
- Data that's acceptable to be slightly stale
- Read-heavy operations
- Complex aggregations where recalculation is expensive

**Examples:**
- Admin overview: 2 minutes
- VIP requirements: 1 hour (config data)
- Team statistics: 10 minutes

---

### 2. **Write-Through Cache Update**
Update cache immediately after write operations.

**When to use:**
- Data that must be consistent
- Single-entity caches (like bank details)

**Example:**
```typescript
// After updating bank details
const updatedBank = await prisma.bank.update({ ... });
await Cache.set(CacheKey.bank(userId), updatedBank, 2 * 24 * 60 * 60);
```

---

### 3. **Cache Deletion on Write**
Delete cache entries when data changes, forcing fresh read.

**When to use:**
- Complex queries with multiple cache keys
- Paginated results where specific keys are hard to target

**Example:**
```typescript
// After placing a bet
await Cache.del(CacheKey.wingoBets(user.id)); // Deletes all cached bet pages
```

---

### 4. **Event-Based Invalidation**
Invalidate cache based on specific events in the system.

**When to use:**
- Background jobs that update data
- Distributed systems

**Example:**
```typescript
// When VIP level calculation job runs
await Cache.del(CacheKey.vipStatus(userId));
await Cache.del(CacheKey.teamOverview(userId));
```

---

## Best Practices

### 1. **Always Handle Cache Failures Gracefully**
The Cache class already does this - it returns `null` on failure.

```typescript
const cached = await Cache.get<Data>(key);
if (cached) {
    return cached; // Cache hit
}
// Cache miss or failure - fetch from DB
const data = await fetchFromDB();
return data;
```

### 2. **Use Appropriate TTL Values**

| Data Type | Recommended TTL | Reason |
|-----------|-----------------|--------|
| Static config | 1+ hours | Rarely changes |
| Aggregated stats | 2-5 minutes | Expensive to calculate, acceptable staleness |
| User-specific lists | 5-15 minutes | Balance between freshness and performance |
| Historical data | 30+ minutes | Never changes once created |
| Active/current data | 5-30 seconds | Changes frequently |

### 3. **Use Hash Caching for Paginated Data**

Instead of:
```typescript
Cache.set(`bets:${userId}:page${page}`, data, ttl); // Many keys per user
```

Use:
```typescript
Cache.hset(`bets:${userId}`, `page:${page}-limit:${limit}`, data, ttl); // One key per user
```

**Benefits:**
- Easier cache invalidation (delete one key)
- Better Redis memory management
- Logical grouping of related data

### 4. **Namespace Your Cache Keys**

Use the `CacheKey` class to create consistent, collision-free keys:

```typescript
// Add new keys to CacheKey class
static teamMembers = (userId: string) => `user:${userId}:team-members`;
static vipStatus = (userId: string) => `user:${userId}:vip-status`;
```

**Naming Convention:**
- User-specific: `user:{userId}:{resource}`
- Admin/Global: `admin:{resource}` or `config:{resource}`
- Game-specific: `game:{gameName}:{resource}`

### 5. **Cache Warm-Up for Critical Data**

For very important data, pre-populate cache:

```typescript
// On server startup or via cron
async function warmUpCache() {
    const vipRequirements = await prisma.vipLevelRequirement.findMany();
    await Cache.set(CacheKey.vipRequirements, vipRequirements, 60 * 60);

    const commissionRates = await prisma.commissionRateConfig.findMany();
    await Cache.set(CacheKey.commissionRates, commissionRates, 60 * 60);
}
```

### 6. **Monitor Cache Performance**

The Cache class logs hits/misses. Monitor these logs to:
- Identify frequently accessed data
- Adjust TTL values
- Detect cache thrashing

### 7. **Don't Cache Everything**

**Avoid caching:**
- Write-heavy operations (creates, updates)
- Real-time data requirements (account balance)
- Simple single-row lookups (already fast)
- Data that changes with every request

---

## Implementation Priority Checklist

Use this checklist to implement caching systematically:

### Phase 1: High Impact (Implement First)
- [ ] Team members route - Most expensive query
- [ ] Team overview route - Add Redis on top of TeamMetrics
- [ ] VIP status route - Multiple table joins
- [ ] Commission breakdown route - Complex aggregations
- [ ] Transaction routes (deposits/withdrawals) - Paginated historical data

### Phase 2: Quick Wins
- [ ] VIP requirements route - Static config data
- [ ] Commission rates route - Static config data
- [ ] Daily commission route - Historical summary data
- [ ] Admin gifts route - Infrequently changing data

### Phase 3: Fine-Tuning
- [ ] Game period routes - Two-tier caching strategy
- [ ] Game result routes - Historical data
- [ ] Single result routes - Static resolved data

### Phase 4: Advanced
- [ ] Implement cache warm-up for config data
- [ ] Add cache monitoring dashboard
- [ ] Optimize TTL values based on usage patterns
- [ ] Consider cache invalidation webhooks for distributed systems

---

## Testing Cache Implementation

### 1. **Test Cache Hit/Miss**
```typescript
// First request - should miss and hit DB
const response1 = await fetch("/api/user/team/overview");
// Check logs for "cache miss"

// Second request - should hit cache
const response2 = await fetch("/api/user/team/overview");
// Check logs for "cache hit"

// Verify both responses are identical
expect(response1).toEqual(response2);
```

### 2. **Test Cache Invalidation**
```typescript
// Get cached data
const before = await fetch("/api/user/deposits");

// Perform write operation
await fetch("/api/payment/deposit", { method: "POST", ... });

// Get data again - should be fresh
const after = await fetch("/api/user/deposits");

// Verify data includes new deposit
expect(after.deposits.length).toBe(before.deposits.length + 1);
```

### 3. **Test Cache Expiration**
```typescript
// Set short TTL for testing
await Cache.set(key, value, 2); // 2 seconds

// Immediate read - should hit
const cached1 = await Cache.get(key);
expect(cached1).not.toBeNull();

// Wait for expiration
await sleep(3000);

// Read again - should miss
const cached2 = await Cache.get(key);
expect(cached2).toBeNull();
```

### 4. **Test Cache Failure Handling**
```typescript
// Disable cache or kill Redis
process.env.DISABLE_CACHE = "true";

// Request should still work (graceful degradation)
const response = await fetch("/api/user/vip/status");
expect(response.status).toBe(200);
```

---

## Common Pitfalls to Avoid

### 1. **Caching User-Specific Data with Global Keys**
```typescript
// ❌ Wrong - all users share same cache
Cache.set("vip-status", data, ttl);

// ✅ Correct - user-specific cache
Cache.set(CacheKey.vipStatus(user.id), data, ttl);
```

### 2. **Forgetting to Invalidate Cache**
```typescript
// ❌ Wrong - cache never invalidated
await prisma.bank.update({ ... });
return c.json({ success: true });

// ✅ Correct - update cache on write
const updated = await prisma.bank.update({ ... });
await Cache.set(CacheKey.bank(userId), updated, ttl);
```

### 3. **Setting TTL Too Long for Volatile Data**
```typescript
// ❌ Wrong - current period cached for 1 hour (changes every minute!)
Cache.set(CacheKey.wingoCurrentPeriod(), period, 60 * 60);

// ✅ Correct - short TTL for volatile data
Cache.set(CacheKey.wingoCurrentPeriod(), period, 10);
```

### 4. **Not Using Hash Caching for Related Data**
```typescript
// ❌ Wrong - creates many keys
Cache.set(`${userId}:page1`, data1, ttl);
Cache.set(`${userId}:page2`, data2, ttl);
// Hard to invalidate all pages

// ✅ Correct - use hash for related data
Cache.hset(CacheKey.teamMembers(userId), "page1", data1, ttl);
Cache.hset(CacheKey.teamMembers(userId), "page2", data2, ttl);
// Easy to invalidate: Cache.del(CacheKey.teamMembers(userId))
```

### 5. **Caching Errors or Invalid Data**
```typescript
// ❌ Wrong - caches null/undefined
const data = await someQuery(); // might return null
await Cache.set(key, data, ttl); // caches null!

// ✅ Correct - validate before caching
const data = await someQuery();
if (data) {
    await Cache.set(key, data, ttl);
}
```

---

## Summary

The custom caching system is well-designed with proper error handling and monitoring. The main opportunities for improvement are:

1. **High-Value Targets**: Team routes, VIP routes, and transaction routes will benefit most from caching
2. **Quick Wins**: Static configuration data (VIP requirements, commission rates) should be cached immediately
3. **Strategy**: Use hash-based caching for paginated data, regular caching for single entities
4. **TTL Guidelines**:
   - Static config: 1+ hours
   - Aggregations: 2-5 minutes
   - Historical data: 30+ minutes
   - User lists: 5-15 minutes

Implementing caching in the high-priority routes will significantly reduce database load and improve response times, especially for users with large teams or extensive transaction history.
