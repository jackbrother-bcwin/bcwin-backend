`
Below is a clean, production-ready, crystal-clear documentation written from base, using the time-derived approach only. You can directly put this into a tech spec / product doc / backend design doc.

---

# 📘 Period Number Logic – Time-Derived Game Rounds System

---

## 1️⃣ Purpose of This Document

This document defines a deterministic and stateless system to generate a Period Number for time-based games (30s, 1m, 3m, 5m).

The system:

* Does not rely on counters
* Does not require manual resets
* Uses current time to calculate the active period
* Guarantees unique (per game duration), sequential periods per day

---

## 2️⃣ Key Concept

> A period is derived directly from the current time of day.

At any moment:

1. We calculate how many seconds have passed since midnight
2. We divide that by the game duration
3. We obtain the current period number

This makes the system purely time-based.

---

## 3️⃣ Period Number Structure

PERIOD_NUMBER = YYYYMMDD + PERIOD_COUNT

### Components

| Part         | Description                        |
| ------------ | ---------------------------------- |
| YYYY         | Year (4 digits)                    |
| MM           | Month (2 digits)                   |
| DD           | Day (2 digits)                     |
| PERIOD_COUNT | Sequential round number of the day |

### Example

Date: 2025-12-28
Period Count: 0045

→ Period Number = 202512280045

---

## 4️⃣ Time Constants (Base Rules)

### Minutes in a Day

24 × 60 = 1440 minutes

### Seconds in a Day

24 × 60 × 60 = 86400 seconds

All game durations must divide evenly into 86400 seconds.

---

## 5️⃣ Seconds Since Midnight

To determine the current period, we first calculate seconds elapsed since the start of the day.

SECONDS_SINCE_MIDNIGHT =
(hour × 3600) +
(minute × 60) +
second

### Example

Time = 12:00:00

SECONDS_SINCE_MIDNIGHT =
(12 × 3600) = 43200

---

## 6️⃣ Core Period Calculation Formula (🔥 Most Important)

PERIOD_COUNT =
floor(SECONDS_SINCE_MIDNIGHT / GAME_DURATION_IN_SECONDS) + 1

### Why +1?

* At 00:00:00, seconds since midnight = 0
* The first period must be 0001, not 0000

---

## 7️⃣ Automatic Daily Reset

At midnight:

SECONDS_SINCE_MIDNIGHT = 0
PERIOD_COUNT = 1

✔ No manual reset
✔ No cron jobs
✔ No database state

---

## 8️⃣ Game-Wise Period Definitions & Examples

Assume Date = 2025-12-28

---

## 🟢 30-Second Game

### Duration

30 seconds

### Periods per Day

86400 / 30 = 2880 periods

### Examples

| Time     | Seconds Since Midnight | Period Count | Period Number |
| -------- | ---------------------- | ------------ | ------------- |
| 00:00:05 | 5                      | 0001         | 202512280001  |
| 00:00:30 | 30                     | 0002         | 202512280002  |
| 12:00:00 | 43200                  | 1441         | 202512281441  |
| 23:59:59 | 86399                  | 2880         | 202512282880  |

---

## 🟢 1-Minute Game

### Duration

60 seconds

### Periods per Day

86400 / 60 = 1440 periods

### Examples

| Time     | Seconds Since Midnight | Period Count | Period Number |
| -------- | ---------------------- | ------------ | ------------- |
| 00:00:10 | 10                     | 0001         | 202512280001  |
| 00:01:00 | 60                     | 0002         | 202512280002  |
| 12:00:00 | 43200                  | 0721         | 202512280721  |
| 23:59:59 | 86399                  | 1440         | 202512281440  |

---

## 🟢 3-Minute Game

### Duration

180 seconds

### Periods per Day

86400 / 180 = 480 periods

### Examples

| Time     | Seconds Since Midnight | Period Count | Period Number |
| -------- | ---------------------- | ------------ | ------------- |
| 00:02:00 | 120                    | 0001         | 202512280001  |
| 00:03:00 | 180                    | 0002         | 202512280002  |
| 12:00:00 | 43200                  | 0241         | 202512280241  |
| 23:59:59 | 86399                  | 0480         |