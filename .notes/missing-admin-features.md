# Missing Admin Features Implementation Checklist

This document lists all admin features mentioned in the PDF that need to be implemented.

## 1. Profit and Loss Dashboard

**Status**: ❌ Not Implemented

### Required Features:
- **Date Filters**: Support for multiple time periods
  - Today
  - Yesterday
  - This week
  - Last week
  - This month
  - Last month

- **Win/Loss Distribution**: 
  - Total win and loss breakdown
  - Visual distribution data

- **Game Performance Metrics** (for wingo, trx, 5d, k3):
  - Win rate per game
  - ROI per game

- **Investment and Return Analysis**:
  - Total invested per game (wingo, trx, 5d, k3)
  - Total win per game (wingo, trx, 5d, k3)

### Card Items Required:
- Total bets (with total wins and total losses)
- Total invested (with avg bet)
- Win rate (with loss rate)
- Net P/L for admin (with ROI)

### Game Wise Statistics (JSON Format):
**Endpoint**: `/admin/profit-loss/game-statistics`

**Required Fields per Game** (wingo, trx, 5d, k3):
- Game name
- Total bets
- Total invested
- Total won
- Win rate
- Net P/L
- ROI

**Note**: Current `/admin/overview` has basic bet/win/profit data but lacks:
- Date filtering options
- Game-wise breakdown in required format
- Win/Loss distribution
- Investment analysis per game
- ROI calculations per game

---

## 2. Agent Performance

**Status**: ❌ Not Implemented

**Current State**: 
- `/admin/agent/list` - Lists agents
- `/admin/agent/create` - Creates agents
- `/admin/users/:id` - Has some user stats but not agent-specific performance

### Required Features:

**Endpoint**: `/admin/agent/:id/performance`

### Card Items:
- **Total network size in first level**: Count of direct downlines (level 1)
- **Total Deposits**: 
  - Agent's own deposits
  - All downline deposits (all levels)
  - Retention rate calculation
- **Net Profit**: 
  - With win rate
- **Commission earned**: 
  - With total number of bets

### Level-wise Performance Breakdown (Level 1):
**Required Fields**:
- Deposits
- BetAmount
- Win amount

### Network Level Distribution:
**Required**: Number of users in each level (1-6 or as configured)

### Network Performance Metrics (All Levels Total):
- Win rate
- Average bet
- Efficiency

**Note**: Current `calculateUserStats` helper in `/admin/users/helpers.ts` has some of this data but needs to be:
- Formatted specifically for agent performance
- Include commission calculations
- Include retention rate
- Include efficiency metrics
- Provide level-wise breakdown

---

## 3. Levelwise Performance Details

**Status**: ❌ Not Implemented

**Endpoint**: `/admin/levelwise-performance`

**Required Fields per Level**:
- Level (1, 2, 3, etc.)
- Users (count)
- Total deposits
- Total withdrawals
- Total bet amount
- Total win amount
- Profit/Loss

**Note**: This should aggregate data across all users at each level in the network hierarchy.

---

## 4. Agent Details

**Status**: ⚠️ Partially Implemented

**Current State**: 
- `/admin/users/:id` provides user details
- `/admin/agent/list` lists agents

**Required Fields** (for agent-specific endpoint):
- UserID
- Username
- Mobile
- Wallet balance
- Account type
- Created at

**Note**: Current implementation may have these fields but needs verification if it's specifically formatted for agents.

---

## 5. Top Performance (Top Players)

**Status**: ❌ Not Implemented

**Endpoint**: `/admin/top-performance`

### Time Filters Required:
- All time
- This week
- This month
- This year

### Card Items:
- Total deposits (aggregate of top 3)
- Average ROI (aggregate of top 3)
- Total bets (aggregate of top 3)
- Average win rate (aggregate of top 3)

### Top Three Performers:
**Required Fields per Player**:
- Username
- Mobile
- Status
- Total deposits
- Total withdrawals
- Betting activity (total no of bets)
- Current balance
- Avg bet size
- Activity score
- Retention rate
- Net profit

**Note**: Need to define "activity score" calculation logic. This is likely a composite metric based on betting frequency, deposit frequency, and other engagement metrics.

---

## Implementation Priority

1. **High Priority**:
   - Profit and Loss Dashboard (core revenue tracking)
   - Agent Performance (key for agent management)

2. **Medium Priority**:
   - Top Performance (useful for identifying VIP players)
   - Levelwise Performance Details (network analysis)

3. **Low Priority**:
   - Agent Details (may already be covered by existing endpoints)

---

## Technical Notes

### Database Queries Needed:
- Game-wise aggregation queries for wingo, trx, 5d, k3
- Level-wise user aggregation
- Commission calculation queries
- Retention rate calculations
- Activity score calculations

### Date Filtering:
- Implement reusable date range utilities for:
  - Today/Yesterday
  - This week/Last week
  - This month/Last month

### Caching Strategy:
- Consider caching for performance-heavy queries
- Current implementation uses Redis cache (CacheKey pattern)
- Follow existing caching patterns in `/admin/overview.ts`

### API Response Format:
- Follow existing OpenAPI schema patterns
- Use Zod schemas for validation
- Maintain consistency with existing admin routes

