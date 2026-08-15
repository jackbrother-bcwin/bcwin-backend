# 🎲 Wingo Game Database & Logic Plan

## 1. Purpose
The system supports **multiple timed betting games** (30s, 1m, 3m, 5m).  
- Each game runs in **periods**.  
- Players place **bets** on outcomes (color/number).  
- After the period ends, results are declared → bets are settled (win/lose).  
- System tracks **bet histories, outcomes, statistics, and financial integrity**.  

---

## 2. Core Entities (Database Tables)

### **1. periods**
Represents each timed game period.  
- `period_id` (PK)  
- `duration_seconds` (30, 60, 180, 300)  
- `start_time`  
- `end_time`  
- `result_value` (e.g., “Red”, “Blue”, “Yellow”, or number)  
- `created_at`  

⚡ Every period exists whether bets are placed or not.  

---

### **2. bets**
Stores individual bets placed by users.  
- `bet_id` (PK)  
- `user_id` (FK → users)  
- `period_id` (FK → periods)  
- `bet_amount` (DECIMAL)  
- `bet_choice` (value/color chosen)  
- `placed_at`  

---

### **3. bet_outcomes**
Stores evaluation of each bet after results are declared.  
- `bet_outcome_id` (PK)  
- `bet_id` (FK → bets)  
- `is_win` (BOOLEAN)  
- `win_amount` (DECIMAL, 0 if lost)  
- `processed_at`  

---

### **4. ledger**
Financial transaction history (to avoid balance mismatches).  
- `ledger_id` (PK)  
- `user_id` (FK → users)  
- `transaction_type` (deposit, withdrawal, bet, win, refund)  
- `amount` (positive/negative)  
- `related_bet_id` (nullable, FK → bets)  
- `balance_after`  
- `created_at`  

---

### **5. period_stats** (optional performance table)
Pre-aggregated stats for reporting.  
- `period_id` (FK → periods)  
- `total_bets`  
- `total_amount_bet`  
- `total_winners`  
- `total_payout`  

---

## 3. Game Flow Logic

### Step 1: Period Creation
- System auto-creates new row in `periods` every X seconds (30/60/180/300).  
- Example: period (id=1001, duration=60, start=12:00, end=12:01).  

### Step 2: Users Place Bets
- User selects `bet_choice` and `bet_amount`.  
- Insert row in `bets`.  
- Insert row in `ledger` with `transaction_type = bet` and `amount = -bet_amount`.  

### Step 3: Period Ends → Result Declared
- System updates `result_value` in `periods`.  

### Step 4: Resolve Bets
- For each bet in that `period_id`:  
  - Compare `bet_choice` with `result_value`.  
  - If match → calculate `win_amount`.  
  - Insert row in `bet_outcomes`.  
  - Update `ledger` with `transaction_type = win` and `amount = +win_amount`.  
  - Update `users.balance`.  

### Step 5: Skipped Periods
- If user doesn’t bet → no entry in `bets`.  
- Still, period row exists in `periods` with result logged.  

### Step 6: Statistics (optional)
- After settlement, insert/update `period_stats` (total bets, winners, payout).  

---

## 4. Example Simulation

### Period 1001 (12:00–12:01)
- Alice bets ₹100 on Red.  
- Bob bets ₹200 on Green.  
- Result = Red.  

✅ Alice wins ₹200 (ledger updates balance).  
❌ Bob loses (ledger deducts ₹200).  

### Period 1002 (12:01–12:02)
- No bets → only result logged.  

### Period 1003 (12:02–12:03)
- Alice bets ₹150 on Yellow.  
- Result = Yellow → Alice wins ₹300.  

---

## 5. Implementation Rules
1. Always **insert periods** on schedule, even if no bets are placed.  
2. Every bet must create a **ledger transaction**.  
3. Settlement is atomic:
   - Update `bet_outcomes`.  
   - Update `ledger`.  
   - Update `users.balance`.  
4. **Idempotent processing** → running settlement again must not double-pay.  
5. Ensure **indexes**:
   - `bets(period_id)`  
   - `bets(user_id)`  
   - `ledger(user_id)`  
   - `periods(start_time, duration_seconds)`  

---

<!-- logics  -->

# 🎮 Wingo Game Logic (Final Rules)

## 1. Bet Types

- 🎨 **Color Bets**
  - Red (even numbers)
  - Green (odd numbers)
  - Violet (special → only numbers 0 and 5)

- 🔢 **Number Bets**
  - Single number bet (0–9)

- 📏 **Size Bets**
  - Big → 5–9
  - Small → 0–4

---

## 2. Result Generation
- Each game period generates a **random number (0–9)**.
- From this number:
  - Determine **Color**
    - Even → Red
    - Odd → Green
    - Special: 0 → Violet + Red, 5 → Violet + Green
  - Determine **Size**
    - 0–4 → Small
    - 5–9 → Big

---

## 3. Rules & Payouts (after service fee deduction)

💰 Assume a **2% service fee**.  
- Contract amount = bet_amount – (2% of bet_amount).  
- All multipliers apply on **contract amount**.  

---

### A. Number Bets (0–9)
- If result matches number → **Win = contract × 9**  

Example: Bet 100 on 8 → contract = 98 → payout = 98 × 9 = 882  

---

### B. Color Bets
- **Green** → Wins if result is odd (1,3,7,9).  
- **Red** → Wins if result is even (2,4,6,8).  
- **Special Violet Combos**:
  - If result = **0** → Violet + Red  
    - Red bets win **1.5×**  
    - Violet bets win **4.5×**  
  - If result = **5** → Violet + Green  
    - Green bets win **1.5×**  
    - Violet bets win **4.5×**

**Normal payout (no special):** contract × 2  

**Special payout:**  
- Red + 0 → contract × 1.5  
- Green + 5 → contract × 1.5  
- Violet + (0 or 5) → contract × 4.5  

---

### C. Violet Bets
- If result = 0 or 5 → **Win = contract × 4.5**  
- Else → Lose bet  

---

### D. Big / Small Bets
- **Big** → Wins if 5–9 → payout = contract × 2  
- **Small** → Wins if 0–4 → payout = contract × 2  
- Exception:
  - If result = 0 or 5 → Only Violet wins.  
  - Big/Small lose.  

---

## 4. Example Scenarios

### Example 1
- Bet: 100 on Green  
- Result = 3 (odd)  
- Contract = 98  
- Payout = 98 × 2 = 196  

---

### Example 2
- Bet: 100 on Red  
- Result = 0 (special case)  
- Contract = 98  
- Red + Violet → payout = 98 × 1.5 = 147  

---

### Example 3
- Bet: 100 on Violet  
- Result = 5 (special case)  
- Contract = 98  
- Violet → payout = 98 × 4.5 = 441  

---

### Example 4
- Bet: 100 on Big  
- Result = 8  
- Contract = 98  
- Payout = 98 × 2 = 196  

---

### Example 5
- Bet: 100 on Small  
- Result = 0  
- Contract = 98  
- Small loses (since 0 is Violet+Red only)  

---

## 5. Settlement Logic

1. Deduct **service fee** → contract amount.  
2. Generate **result_number (0–9)**.  
3. Derive:
   - Color (Red/Green/Violet combo if 0 or 5).  
   - Size (Big/Small, except special override).  
4. For each bet:
   - Check bet type.  
   - Apply multiplier according to rules.  
   - Insert into `bet_outcomes`.  
   - Update `ledger` and user balance.  

---

## 6. Efficiency Rules for AI

- Always calculate `contract_amount = bet_amount – (bet_amount × fee%)`.  
- Map result → outcome **before evaluating bets**.  
- If result is **0** or **5**, treat as **two outcomes (Violet + Red/Green)**.  
- Multipliers:
  - Red/Green normal = 2×  
  - Red/Green with Violet combo = 1.5×  
  - Violet = 4.5×  
  - Number = 9×  
  - Big/Small = 2× (except 0/5)  
- Ensure settlement is atomic and idempotent.  

---
