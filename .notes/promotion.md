# 🏆 Commission & VIP System (33 Club)

This document explains the **promotion and commission system** in a clear, example-driven way.  
It covers:  
1. **6-Level Referral Structure** (normal subordinate system).  
2. **10 VIP Levels** (personal ranking).  
3. **Commission Percentages** (depend on both referral level & personal VIP).  
4. **Examples + Edge Cases**.  

---

## 1. 👥 Subordinate Levels (6 Layers)
Every user has **up to 6 subordinate levels** when inviting friends.

- If **A invites B** → B = A’s **Level 1 subordinate**.  
- If **B invites C** → C = A’s **Level 2 subordinate** (and B’s Level 1).  
- If **C invites D** → D = A’s **Level 3 subordinate**.  
- … continues until **Level 6**.

You → A (L1) → B (L2) → C (L3) → D (L4) → E (L5) → F (L6)

markdown
Copy code

📌 **Key Points**
- You always have exactly **6 layers of commission eligibility**.  
- Your **VIP level** determines how much % commission you get from each layer.  

---

## 2. 🎖 VIP Levels (Personal Rank)

Each user has a **personal VIP level** (0–10).  
Your VIP is based on **team size, total betting, and deposits** (see the second image).

| VIP Level | Required Team Size | Required Team Betting | Required Team Deposit |
|-----------|--------------------|------------------------|-----------------------|
| L0        | 0                  | 0                      | 0                     |
| L1        | 10                 | 500K                   | 100K                  |
| L2        | 15                 | 1M                     | 200K                  |
| L3        | 30                 | 2.5M                   | 500K                  |
| L4        | 45                 | 3.5M                   | 700K                  |
| L5        | 50                 | 5M                     | 1M                    |
| L6        | 60                 | 10M                    | 2M                    |
| L7        | 100                | 100M                   | 20M                   |
| L8        | 500                | 500M                   | 100M                  |
| L9        | 1000               | 1B                     | 200M                  |
| L10       | 5000               | 1.5B                   | 300M                  |

📌 **Example**  
- You have **20 team members**, total team betting **2M**, team deposit **300K**.  
- This qualifies you for **VIP Level 2**.  

---

## 3. 📊 Commission Percentages

Commission % = **based on your VIP Level + subordinate layer**.  
Higher VIP = better % at all layers.

## 3.1 VIP 0 Commission (Base Level)
- L1 = **0.6%**  
- L2 = **0.18%**  
- L3 = **0.054%**  
- L4 = **0.0162%**  
- L5 = **0.00486%**  
- L6 = **0.001458%**  

## 🔹 VIP 1
- L1 = 0.700%  
- L2 = 0.245%  
- L3 = 0.08575%  
- L4 = 0.030012%  
- L5 = 0.010504%  
- L6 = 0.003677%  

## 🔹 VIP 2
- L1 = 0.750%  
- L2 = 0.28125%  
- L3 = 0.105469%  
- L4 = 0.039551%  
- L5 = 0.014832%  
- L6 = 0.005562%  

## 🔹 VIP 3
- L1 = 0.800%  
- L2 = 0.32%  
- L3 = 0.128%  
- L4 = 0.0512%  
- L5 = 0.002048%  
- L6 = 0.008192%  

## 🔹 VIP 4
- L1 = 0.850%  
- L2 = 0.36125%  
- L3 = 0.153531%  
- L4 = 0.065251%  
- L5 = 0.027732%  
- L6 = 0.011786%  

## 🔹 VIP 5
- L1 = 0.900%  
- L2 = 0.405%  
- L3 = 0.18225%  
- L4 = 0.082013%  
- L5 = 0.036906%  
- L6 = 0.016608%  

## 🔹 VIP 6
- L1 = 1.000%  
- L2 = 0.5%  
- L3 = 0.25%  
- L4 = 0.125%  
- L5 = 0.0635%  
- L6 = 0.03125%  

## 🔹 VIP 7
- L1 = 1.100%  
- L2 = 0.605%  
- L3 = 0.33275%  
- L4 = 0.183013%  
- L5 = 0.100657%  
- L6 = 0.055361%  

## 🔹 VIP 8
- L1 = 1.200%  
- L2 = 0.72000%  
- L3 = 0.432%  
- L4 = 0.2592%  
- L5 = 0.15552%  
- L6 = 0.093312%  

## 🔹 VIP 9
- L1 = 1.300%  
- L2 = 0.845%  
- L3 = 0.54925%  
- L4 = 0.357013%  
- L5 = 0.232058%  
- L6 = 0.150838%  

## 🔹 VIP 10
- L1 = 1.400%  
- L2 = 0.98%  
- L3 = 0.686%  
- L4 = 0.4802%  
- L5 = 0.33614%  
- L6 = 0.235298%  
⚠️ Exact layer % follows a **decay formula** (each layer lower = reduced %).  

---

## 4. 🔁 Flowchart: How Commission is Calculated
```mermaid
flowchart TD
A[Invitee Bets] --> B{Which Layer?}
B --> |L1| C[Apply VIP-based L1%]
B --> |L2| D[Apply VIP-based L2%]
B --> |L3| E[Apply VIP-based L3%]
B --> |L4| F[Apply VIP-based L4%]
B --> |L5| G[Apply VIP-based L5%]
B --> |L6| H[Apply VIP-based L6%]
C --> I[Commission Credited]
D --> I
E --> I
F --> I
G --> I
H --> I
5. 📌 Examples
Example 1: VIP 0 User
You are VIP 0.

Your L1 subordinate bets ₹10,000.

Commission = 0.6% of 10,000 = ₹60.

Example 2: VIP 2 User with L2 Subordinate
You are VIP 2.

Your L2 subordinate bets ₹20,000.

Commission rate = 0.28125%.

Commission = 20,000 × 0.28125% = ₹56.25.

Example 3: VIP 6 Big Upline
You are VIP 6.

Your L1 subordinate bets ₹1,000,000.

Commission = 1% × 1,000,000 = ₹10,000.

Example 4: Multiple Layers
You are VIP 3.

L1 bets ₹50,000 → 0.8% = ₹400.

L2 bets ₹25,000 → 0.28% ≈ ₹70.

L3 bets ₹10,000 → 0.09% ≈ ₹9.

✅ Total = ₹479 commission.

6. ⚠️ Edge Cases
VIP 0 but Large Team

Even with 1000 members, if requirements not met, you stay VIP 0 → lower % commission.

High Bet, Low VIP

L1 bets ₹1M but you are VIP 0 → only 0.6% = ₹6000.

If VIP 6 → 1% = ₹10,000.

Late Upgrade

If you qualify for VIP 3 today, all future commissions use VIP 3 rates.

Past commissions remain as per the old VIP rate.

Inactive Subordinate Chain

If a Level 2 user invites but never bets, you still benefit from Level 3–6 commissions if deeper members bet.

✅ Final Notes
Each user always has 6 subordinate levels.

Each user has a VIP level 0–10, based on team metrics.

Commission = Subordinate Level × Your VIP rate.

Daily commissions calculated after 01:00 AM.

Higher VIP = higher income from the same team activity.