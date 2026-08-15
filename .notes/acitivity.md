🎯 Activity, Invitation & Bonus Logic — Developer Guide

This document explains all logic rules with real-time examples so developers can implement backend APIs, database checks, and reward status calculations.

📌 1. Weekly Tasks Logic
Rules

Reward is based on total slot betting amount in 7 days.

| Slot Bet Amount (Weekly) | Reward |
|--------------------------|--------|
| 10,000                   | 25     |
| 20,000                   | 50     |
| 50,000                   | 200    |
| 100,000                  | 500    |
| 150,000                  | 700    |
| 300,000                  | 1,500  |
Reset

Resets every 7 days

Reward must be claimed manually

API must return completed: true/false per tier

✅ Example (Weekly Task)

User total weekly slot bets = 52,300

| Tier   | Requirement | Status        | Reward |
|--------|-------------|---------------|--------|
| Tier 1 | 10,000      | Completed     | 25     |
| Tier 2 | 20,000      | Completed     | 50     |
| Tier 3 | 50,000      | Completed     | 200    |
| Tier 4 | 100,000     | Not completed | —      |

API Output Example

{
  "weekly": [
    { "bet_required": 10000, "user_bet": 52300, "reward": 25, "completed": true },
    { "bet_required": 20000, "user_bet": 52300, "reward": 50, "completed": true },
    { "bet_required": 50000, "user_bet": 52300, "reward": 200, "completed": true },
    { "bet_required": 100000, "user_bet": 52300, "reward": 500, "completed": false }
  ]
}

📌 2. Daily Tasks Logic
Rules

User must complete both deposit + bet condition within 24 hours.

| Deposit | Bet Required | Reward |
|---------|--------------|--------|
| 300     | 900          | 20     |
| 1,000   | 3,000        | 40     |
| 1,500   | 4,500        | 50     |
| 3,000   | 9,000        | 120    |
| 5,000   | 15,000       | 200    |

Resets every 24 hours

User claims reward manually

API must return completed: true/false

✅ Example (Daily Task)

Today user deposited = 1,000
User total bets today = 3,950

| Tier                 | Status        |
|----------------------|---------------|
| 300 dep + 900 bet    | Completed     |
| 1000 dep + 3000 bet  | Completed     |
| 1500 dep + 4500 bet  | Not completed |

API Output Example

{
  "daily": [
    { "deposit_required": 300, "bet_required": 900, "reward": 20, "completed": true },
    { "deposit_required": 1000, "bet_required": 3000, "reward": 40, "completed": true },
    { "deposit_required": 1500, "bet_required": 4500, "reward": 50, "completed": false }
  ]
}

📌 3. Invitation Bonus Logic
Rules

User invites other users

Each invited user must deposit a minimum amount

Only then the main user gets reward

| Invites | Deposit Required Per Person | Total Deposit | Reward  |
|---------|----------------------------|---------------|---------|
| 1       | 300                        | 300           | 38      |
| 3       | 300                        | 900           | 158     |
| 10      | 500                        | 5,000         | 580     |
| 30      | 800                        | 24,000        | 1,800   |
| 50      | 1,200                      | 60,000        | 2,800   |
| 75      | 1,200                      | 90,000        | 4,500   |
| 100     | 1,200                      | 120,000       | 5,800   |
| 200     | 1,200                      | 240,000       | 11,800  |
| 500     | 1,200                      | 600,000       | 29,000  |
| 1,000   | 1,200                      | 1,200,000     | 58,000  |
| 2,000   | 1,200                      | 2,400,000     | 118,000 |
| 5,000   | 1,200                      | 6,000,000     | 300,000 |
Additional Requirements

User claims reward manually

API must return:

Number of invited users

Number of invited users who deposited

Completed status per tier

✅ Example (Invitation Bonus)

User invited 12 people
Deposits from invited users:

| Invited UID | Deposit |
|-------------|---------|
| 1           | 300     |
| 2           | 500     |
| 3           | 500     |
| 4           | 800     |
| 5           | 1,200   |
| 6-12        | 0       |

Check tier: 10 invites @500 deposit

5 users qualify (deposit ≥ 500)

Not enough (needs 10 users)

API Output Example

{
  "invitation": [
    { "tier": 1, "invites_required": 1, "min_deposit": 300, "reward": 38, "completed": true },
    { "tier": 3, "invites_required": 3, "min_deposit": 300, "reward": 158, "completed": true },
    { "tier": 10, "invites_required": 10, "min_deposit": 500, "reward": 580, "completed": false }
  ],
  "records": [
    { "uid": 1, "username": "abc1", "deposit": 300, "registered_at": "2025-01-11" },
    { "uid": 2, "username": "abc2", "deposit": 500, "registered_at": "2025-01-10" }
  ]
}

📌 4. First Deposit Bonus Logic
Rules

Reward is given only once to the user on first ever deposit.

| First Deposit | Reward |
|---------------|--------|
| 100           | 18     |
| 300           | 28     |
| 500           | 108    |
| 1,000         | 188    |
| 5,000         | 488    |
Auto-credit

User gets reward instantly when first deposit matches tier

API returns completed: true/false

✅ Example (First Deposit Bonus)

User's first deposit = 500

Reward = 108 automatically applied.

API Output Example

{
  "firstDeposit": {
    "deposit": 500,
    "reward": 108,
    "completed": true
  }
}

📌 5. attendence

Overview

The system rewards users for logging in daily, up to 7 consecutive days. Each day has:

A required accumulated deposit amount

An attendance bonus amount

A user can claim the reward once per day. Players with no deposit history cannot claim any bonus. Deposit requirements start from day one.

🧮 Bonus Table
| Day | Accumulated Deposit Required | Bonus Amount |
|-----|------------------------------|--------------|
| 1   | ₹200                         | ₹5           |
| 2   | ₹1,000                       | ₹18          |
| 3   | ₹3,000                       | ₹100         |
| 4   | ₹10,000                      | ₹200         |
| 5   | ₹20,000                      | ₹400         |
| 6   | ₹100,000                     | ₹3,000       |
| 7   | ₹200,000                     | ₹7,000       |
🛠 Backend Logic Flow
1. Track Login Streak

When a user logs in:

If last login was yesterday → streak + 1

Else → reset streak to 1

Maximum streak capped at 7 days.

2. Check Eligibility

A user is eligible only if:

Has deposit history (deposit > 0)

Has not already claimed today's bonus

Meets the deposit requirement based on streak day

3. Deposit Requirement Check
if user.total_deposit >= required_deposit_for_day[streak]:
    eligible = true
else:
    eligible = false
    
4. Award Bonus

On successful claim:

Insert record into attendance_rewards

Mark today's reward as claimed

Add bonus amount to user's wallet/balance

5. Reset Conditions

If user misses a day → streak resets to 1

If fraudulent behavior detected → block reward
