# 🏁 Moto Racing Lottery — Backend Logic & Examples (NO TABLES)

> **Goal:** Clear, backend-focused logic and settlement rules for the Moto Racing Lottery game. No database schema; pure logic, formulas, algorithmic flow, and many worked examples (step-by-step arithmetic).

---

## 1) Quick summary

* There are **10 bikes** numbered **1–10**. Each period produces **three unique finishing positions**: **1st**, **2nd**, **3rd**.

* Players place bets during the betting window. Bets are evaluated when the period closes and results are generated.

* **Bet types:**

  * **Position** — bet a specific bike to finish exactly in 1st, 2nd, or 3rd. (Payout: **9.8×**)
  * **Odd/Even** — predict whether the bike number in a chosen position is odd or even. (Payout: **2×**)
  * **Big/Small** — predict whether the bike number in a chosen position is **Big (6–10)** or **Small (1–5)**. (Payout: **2×**)

* **Service fee:** 2% (example; configurable). All multipliers apply to the **contract amount** after fee deduction.

* **Currency rounding:** Use smallest currency unit (paise/cents) internally; round final payout to 2 decimal places (round half-up) for display and ledger.

---

## 2) Key formulas & rules (short)

1. **Fee & contract amount (in rupees):**

   * `contract = bet_amount - (bet_amount × fee%)`
   * Example formula used in all calculations.

2. **Payouts:**

   * Position bet → `payout = contract × 9.8`
   * Odd/Even → `payout = contract × 2`
   * Big/Small → `payout = contract × 2`

3. **Precision rule (recommended):**

   * Convert rupees to paise (multiply by 100) and perform integer arithmetic.
   * Fee and multipliers are applied on paise and final result is divided by 100 and rounded to 2 decimal places.

4. **Idempotency:**

   * Settlement must be idempotent: if the settlement job runs twice for the same period, it should **not** double-pay. Use a per-bet processed flag or check for existing outcome/ledger entry before creating new ones.

5. **Atomicity:**

   * Settlement for each bet must be done in a single atomic transaction: create outcome, ledger entry, and update user balance together; or roll back on error.

6. **Unique finishing positions:**

   * Generated results must guarantee three **distinct** bike numbers (1–10) for 1st/2nd/3rd.

---

## 3) High-level settlement flow (algorithm)

1. **Period closes.** Betting closes at cutoff time.

2. **Generate results** (random unique 1st, 2nd, 3rd bikes). Example: `(1st=7, 2nd=3, 3rd=10)`.

3. **Load bets** placed for that period that are not yet processed.

4. For each bet:

   * Compute `contract` (after fee).
   * Evaluate winning condition according to bet type and target position.
   * Compute `win_amount` (0 if lost) using multipliers on the `contract`.
   * Persist a single **bet outcome** record (only if not already present).
   * Create corresponding **ledger** transaction(s) and **apply** the win\_amount to the user's balance.

5. **Post-settlement**: update any cached stats (if used) and mark the period settled.

**Notes:**

* Use `SELECT ... FOR UPDATE` (or equivalent) on user balance when crediting to avoid race conditions.
* If a settlement fails mid-way, roll back and retry; the idempotency check prevents double-credit.

---

## 4) Evaluation rules (expanded, unambiguous)

### 4.1 Position bets (exact)

* **What wins:** `bet_choice == bike_number_in_target_position`.
* **Multiplier:** `9.8×` applied to `contract`.

### 4.2 Odd/Even bets

* **What wins:**

  * If `bet_choice` = `odd` → wins when `bike_number % 2 == 1` (1,3,5,7,9).
  * If `bet_choice` = `even` → wins when `bike_number % 2 == 0` (2,4,6,8,10).
* **Multiplier:** `2×` applied to `contract`.

### 4.3 Big/Small bets

* **Definition:** `Small` = numbers `1..5`; `Big` = numbers `6..10`.
* **What wins:** check whether the bike number in the chosen position lies in the chosen range.
* **Multiplier:** `2×` applied to `contract`.
* **Important:** boundaries (5 and 6) are definitive: 5 → Small, 6 → Big.

---

## 5) Money-handling rules (precision & rounding)

* **Internal representation:** store money in **paise** (integer) to avoid floating-point errors.

  * Example: ₹199 → `19900` paise.
* **Fee calculation (paise):**

  * `fee_paise = floor((bet_paise × fee_percent) / 100)` or allow exact fraction then round half-up to nearest paise depending on product policy. (Prefer exact fractional paise handling + round half-up.)
* **Contract (paise):** `contract_paise = bet_paise - fee_paise`.
* **Apply multiplier in rational arithmetic** then round final payout to nearest paise (round half-up). Convert to rupees (divide by 100) and format to 2 decimals.

**Example of integer-safe approach:**

* bet\_paise × multiplier = may produce fractional paise; keep as integer by rounding half-up.

---

## 6) Idempotency & retry behavior (practical)

* Each bet must have a durable marker that settlement was attempted/completed. Approaches:

  * Create `bet_outcome` record with `processed_at` timestamp; if `bet_outcome` exists, skip processing.
  * Or use a `processed` boolean on `bets` and use an insert-if-not-exists for `bet_outcomes`.
* The settlement job should:

  1. Begin transaction.
  2. Select bets not processed for the period.
  3. For each bet, check again whether `bet_outcome` exists; if not, compute outcome and insert outcome + ledger + update balance.
  4. Commit.

This guarantees that retries are safe (no duplicate payouts).

---

## 7) Error & fraud handling (rules)

* **Late bets:** reject at insertion if placed after `bet_cutoff` for the period. Log attempted late bets for auditing.
* **Invalid bets:** if a bet references a non-existent position (e.g., position 4) or invalid choice, reject and optionally refund.
* **Duplicate/conflicting bets by same user:** allowed (user can place multiple bets), evaluate each independently.
* **Impossible outcome (e.g., duplicate numbers in result generator):** do not publish. If generator produces invalid result, mark period as errored, refund all bets, and investigate.
* **Partial system failure mid-settlement:** roll back transaction. On repeated failure, mark the period for manual review and pause retries after N attempts.

---

## 8) Worked examples (many) — ALL STEPS SHOWN DIGIT-BY-DIGIT

> We use **fee = 2%** in every example. We show rupee→paise conversion where needed and show step-by-step arithmetic.

### Example A — Position bet, simple win (₹100)

* **Bet:** ₹100 on **bike 7 to be 1st**.
* **Step 1 — fee:** 2% of 100 = `100 × 2% = 100 × 0.02 = 2.00`.

  * `contract = 100 - 2 = 98.00`.
* **Step 2 — payout multiplier:** Position = 9.8×.
* **Step 3 — payout calculation (digit-by-digit):**

  * `98 × 9.8 = 98 × (9 + 0.8)`.
  * `98 × 9 = 882` (since 9 × 98 = 882).
  * `98 × 0.8 = 78.4` (since 0.8 × 98 = 78.4).
  * `882 + 78.4 = 960.4`.
* **Result:** Payout = **₹960.40** (credit this to user balance).

### Example B — Position bet, lose (₹200)

* **Bet:** ₹200 on **bike 3 to be 2nd**.
* **Result:** finishing order is `(1st=3, 2nd=7, 3rd=4)` → bike 3 finished 1st, not 2nd.
* **Outcome:** Lost. `win_amount = ₹0`.
* **Ledger:** debit at bet placement: `-200`; no win credit.

### Example C — Odd/Even bet win (₹100)

* **Bet:** ₹100 on **1st pos = odd**.
* **Result:** 1st = bike 9 (odd).
* **Fee & contract:** 2% of 100 = 2 → `contract = 98`.
* **Multiplier:** 2×.
* **Payout:** `98 × 2 = 196`.
* **Result:** Payout = **₹196.00**.

### Example D — Odd/Even bet lose (₹100)

* **Bet:** ₹100 on **3rd pos = even**.
* **Result:** 3rd = bike 7 (odd).
* **Outcome:** Lost → `win_amount = ₹0`.

### Example E — Big bet win (₹150)

* **Bet:** ₹150 on **2nd pos = Big** (6–10).
* **Result:** 2nd = bike 10.
* **Fee:** 2% of 150 = `150 × 0.02 = 3.00`.

  * `contract = 150 - 3 = 147.00`.
* **Multiplier:** 2×.
* **Payout:** `147 × 2 = 294.00`.
* **Result:** Payout = **₹294.00**.

### Example F — Small bet at boundary (₹200)

* **Bet:** ₹200 on **2nd pos = Small** (1–5).
* **Result:** 2nd = bike 5.
* **Fee:** 2% of 200 = `4.00` → `contract = 196.00`.
* **Payout:** `196 × 2 = 392.00`.
* **Result:** Payout = **₹392.00**.

### Example G — Boundary loss (Small but result = 6)

* **Bet:** ₹100 on **1st pos = Small**.
* **Result:** 1st = bike 6.
* **Note:** 6 is **Big**, not Small → **lose**.

### Example H — Multiple bets by same user in same period

* **User Bets:**

  1. ₹100 on **1st = bike 4** (position).
  2. ₹50 on **1st = even** (odd/even).
  3. ₹25 on **1st = Big**.
* **Result:** 1st = bike 4.
* **Compute each:**

  * Bet 1: ₹100 → fee 2 → contract 98 → payout `98 × 9.8 =` (98×9=882; 98×0.8=78.4; sum=960.4) → **₹960.40**.
  * Bet 2: ₹50 → fee 1 → contract 49 → payout `49 × 2 = 98` → **₹98.00**.
  * Bet 3: ₹25 → fee 0.50 → contract `25 - 0.5 = 24.50` → payout `24.5 × 2 = 49.0` → **₹49.00**.
* **Total credited:** `960.40 + 98.00 + 49.00 = 1107.40`.

  * (Show small step: `960.40 + 98.00 = 1,058.40`; `1,058.40 + 49.00 = 1,107.40`.)

### Example I — Rounding & paise-safe example (₹199 position bet)

**Use paise integers for clarity.**

* `bet_paise = 199.00 × 100 = 19900` paise.
* `fee_paise = round_half_up(19900 × 2 / 100) = round_half_up(398.0) = 398` paise → ₹3.98.
* `contract_paise = 19900 - 398 = 19502` paise → ₹195.02.
* **Multiplier:** 9.8× → treat multiplier as rational `98/10`.

  * `payout_paise = round_half_up((contract_paise × 98) / 10)`.
  * `contract_paise × 98 = 19502 × 98 = 1,911,196` (digit-by-digit: 19502×100=1,950,200; minus 19502×2=39,004 → 1,950,200 - 39,004 = 1,911,196).
  * Divide by 10: `1,911,196 / 10 = 191,119.6` paise.
  * Round half-up to nearest paise → `191,120` paise → **₹1,911.20**.
* **Result:** Payout = **₹1,911.20**.

### Example J — Very small bet (₹1) to show precision

* `bet_paise = 1.00 × 100 = 100` paise.
* `fee_paise = round_half_up(100 × 2 / 100) = round_half_up(2.0) = 2` paise → ₹0.02.
* `contract_paise = 100 - 2 = 98` paise → ₹0.98.
* Position payout `= 98 paise × 9.8 =` compute using rational arithmetic:

  * `98 × 98 = 9604` (using 9.8 = 98/10 trick later),
  * `payout_paise = round_half_up((98 × 98) / 10) = round_half_up(9604 / 10) = round_half_up(960.4) = 960` paise → ₹9.60.
* **Result:** Payout = **₹9.60**.

### Example K — Multiple users and ledger sanity check (summary)

* **Bets placed in period:**

  * Alice: ₹100 on 1st=bike7 (position).
  * Bob: ₹200 on 2nd=Big.
* **Total stakes collected:** `100 + 200 = ₹300` (ledger shows -300 aggregated as bets).
* **Suppose result:** 1st=7, 2nd=10.
* **Payouts:**

  * Alice payout: use Example A → ₹960.40.
  * Bob: fee 2% of 200 = 4 → contract 196 → payout 196×2 = 392.
* **Total payouts:** `960.40 + 392 = 1,352.40`.
* **Observation:** It's normal that total payouts may exceed total stakes for some periods — the platform must hold a house bank to cover payouts. The ledger must track every transaction so audits reconcile:

  * Stakes collected (−300 at placement).
  * Payout credits (+1,352.40), platform balance delta reflected accordingly.

---

## 9) Pseudocode for settlement (clear & idempotent)

```pseudo
FUNCTION settle_period(period_id):
  results = generate_or_fetch_results(period_id)  # e.g. {first:7, second:3, third:10}

  BEGIN TRANSACTION
    bets = SELECT bets WHERE period_id = period_id AND processed = false FOR UPDATE

    FOR each bet IN bets:
      IF EXISTS(SELECT 1 FROM bet_outcomes WHERE bet_id = bet.id):
        CONTINUE  # already processed

      # compute contract in paise
      bet_paise = to_paise(bet.amount)
      fee_paise = round_half_up(bet_paise * fee_percent / 100)
      contract_paise = bet_paise - fee_paise

      win_amount_paise = 0
      IF bet.type == 'position':
         target_number = results[bet.target_position]
         IF bet.choice == target_number:
           # multiplier 9.8 = 98/10
           win_amount_paise = round_half_up(contract_paise * 98 / 10)

      ELSE IF bet.type == 'odd_even':
         target_number = results[bet.target_position]
         IF (bet.choice == 'odd' AND target_number % 2 == 1) OR
            (bet.choice == 'even' AND target_number % 2 == 0):
            win_amount_paise = contract_paise * 2

      ELSE IF bet.type == 'big_small':
         target_number = results[bet.target_position]
         IF (bet.choice == 'big' AND target_number >= 6) OR
            (bet.choice == 'small' AND target_number <= 5):
            win_amount_paise = contract_paise * 2

      # write outcome (idempotent guard)
      INSERT INTO bet_outcomes(bet_id, is_win, win_amount_paise, processed_at) IF NOT EXISTS

      # ledger and balance update (atomic)
      IF win_amount_paise > 0:
         INSERT ledger credit transaction for win_amount_paise
         UPDATE users SET balance_paise = balance_paise + win_amount_paise WHERE id = bet.user_id

      # mark bet processed
      UPDATE bets SET processed = true WHERE id = bet.id

  COMMIT TRANSACTION

END FUNCTION
```

**Notes on the pseudocode:**

* Use `FOR UPDATE` and a DB transaction to serialize balance updates.
* Use `IF NOT EXISTS` guards around `bet_outcomes` inserts to prevent duplicates.
* All amounts are in paise for safety; only convert to rupees for display and final API responses.

---

## 10) Testing checklist & corner-case scenarios to include in QA

1. Bets placed at exact cutoff boundary (accept or reject consistently).
2. Duplicate bet placement attempts; ensure each is independent.
3. Settlement re-run: ensure no double credits.
4. Result generator produces duplicates → period is errored and all bets refunded.
5. Very large bets (test paise overflow) — ensure database field sizes and integer types handle expected volumes.
6. Rounding behavior checks with odd cents/paise (e.g., ₹199 example).
7. Partial outages during settlement (power loss) — ensure transactions either fully commit or roll back and retries are safe.

---

## 11) Summary / Practical recommendations

* **Always use smallest currency unit (paise)** for internal math.
* **Perform settlement in DB transactions** with idempotency checks (bet\_outcome exists → skip).
* **Round half-up** at final payout stage when converting to displayed rupees.
* **Log every decision** (why a bet won/lost) for audit and customer support.
* **Keep result generation deterministic and auditable** (record RNG seeds or entropy source if regulatory compliance requires).

---

