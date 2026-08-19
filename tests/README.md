# Backend deep tests

Integration + unit tests for API routes and engine services using **bun:test**.

## Prerequisites

```sh
# Postgres + Redis (dev compose)
bun run dev-services
# or ensure local DATABASE_URL / REDIS_URL from .env are up
```

## Run

```sh
# New deep suite only (API + engine)
bun run test:deep

# Everything under tests/ (includes legacy cache/commission files)
bun run test:all

# Same as test:all
bun run test
```

## Layout

```
tests/
  helpers/
    preload.ts      # env defaults before each file
    cleanup.ts      # deletes all data for tracked users + DT_ periods/gifts
    fixtures.ts     # createTestUser, periods, OTP, auth cookie
    http.ts         # Hono app.request client (no Bun.serve)
  api/
    health-basic.test.ts
    auth.test.ts
    games.test.ts                  # wingo/k3/5d/moto/trxwingo
    user-admin-payment.test.ts
    admin-real-success.deep.test.ts  # ADR-0024: real USER + SUCCESS admin summaries
    rebate-user-flow.deep.test.ts  # E2E: place bets → self/team rebate → claim → cron
    rebate-fe-surface.deep.test.ts
    self-rebate.deep.test.ts
    commission-cron-scheduler.deep.test.ts
    commission-l1-to-l6.deep.test.ts
  engine/
    rebate-only.deep.test.ts
    commission-rebate-vip.deep.test.ts
    k3-5d-moto-logic.test.ts
```

### Rebate E2E (recommended local check)

```sh
bun run dev-services
bun test --env-file .env --preload ./tests/helpers/preload.ts \
  tests/api/rebate-user-flow.deep.test.ts
```

Covers: real place-bet on all first-party games → async team + self accrual →
user/admin rebate endpoints → self claim → `RebateScheduler` 01:30 settle →
`SelfRebateScheduler` 01:00 expiry → balances + team overview.

## Data cleanup

Every suite uses `FixtureTracker` and **`afterAll` → `cleanupByUserIds`**:

- All users created in that suite
- Periods with `periodNumber` prefix `DT_…`
- Gifts with code prefix `DTGIFT_…`
- Deposits/withdraws with `DT-…` order ids

No permanent pollution of prod/dev DB if cleanup runs (even on failure, `afterAll` still runs).

## Notes

- Password hashing in app is **MD5** (same as production login).
- Login tests send **national 10-digit** mobile + `countryCode: "91"`.
- Gift redeem path is **`POST /api/v1/redeem`** (not `/gift/redeem`).
- User profile path is **`GET /api/v1/user/user`**.
- Engine period manager tests may create real live periods for durations 30/60/180/300 (production period numbers) — that is intentional exercise of `PeriodManager`.
