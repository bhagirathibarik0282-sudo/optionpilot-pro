# OptionPilot Pro — Scoring Rules Document

**Version:** 1.0
**Status:** Complete — values double-checked directly against `runRuleEngine()` in `server.ts` (verified 2026-08-09)
**Owner:** Bhagirathi Barik
**Reference:** docs/vision.md, docs/architecture.md (defers this document, layer 6 "Scoring Engine")

---

## 1. Purpose

This document is the single source of truth for exactly how the Scoring Engine turns available signals into a score, a verdict, and a confidence tier — and how the Risk Engine turns that verdict into SL/T1/T2. Nothing here is aspirational: every number below was read directly from the live `runRuleEngine()` function, not recalled from memory or estimated.

## 2. Scoring Formula

For each **available** signal (one that passed Data Validation as `OK`), the engine adds a signed value to a running `score`, and adds that signal's weight to a running `maxScore`:

```
score    += signal_value      (can be positive, negative, or 0)
maxScore += signal_weight     (always positive — the signal's max possible pull)
```

`maxScore` therefore reflects only the signals that were actually available this cycle — it is **not** a fixed constant. A cycle with only 6 signals available has a lower `maxScore` than one with all 13 currently-wired signals available.

## 3. Signal Weights — Double-Checked Against Code

| # | Signal | Weight (max pull) | Value rule |
|---|---|---|---|
| 1 | `futures_vwap` | 1 | `0` if `|LTP − VWAP| / VWAP ≤ 0.1%`; else `+1` if LTP > VWAP, `−1` if below |
| 2 | `pdh_pdl` | 1 | `+1` if spot > PDH; `−1` if spot < PDL; else `0` |
| 3 | `oi_pcr` | 1 | `+1` if PCR > 1.2; `−1` if PCR < 0.8; else `0` |
| 4 | `max_pain` | 0.5 | `+0.5` if spot < Max Pain; `−0.5` if spot > Max Pain; else `0` |
| 5 | `india_vix` | 1 | `+1` if VIX change < 0; `−1` if VIX change > 0; else `0` |
| 6 | `futures_oi_buildup` | 1 | `+1` Fresh Long Build-up; `−1` Fresh Short Build-up; else `0` |
| 7 | `gap_type` | 2 (3 if gap > 0.8%) | `0` unless the gap is confirmed as a **Continuation**; if so, `direction × 2`, further `× 1.5` when the gap itself is > 0.8% (so the value can reach `±3`, matching the weight) |
| 8 | `expiry_alignment` | 1.5 | `+1.5` Strong CE cross-expiry alignment; `+1` CE alignment/ATM-CE-supportive/1-ITM-CE-preferred; `−1.5` / `−1` mirrored for PE; `0` for any conflict/noise state |
| 9 | `sector_heatmap` | 1 | `+1` if more green sectors than red; `−1` if more red than green; `0` if equal |
| 10 | `pcr_trend` | 1 | `+1` Bullish Divergence (spot falling, PCR rising); `−1` Bearish Divergence; `0` for aligned/no-clear-divergence |
| 11 | `call_put_wall` | 1.5 | `+1` "PCR + Walls Bullish Supportive"; `−1` "...Bearish Supportive"; `0` for range-risk/volatility-expansion/conflict/trapped/unconfirmed states |
| 12 | `atm_oi_buildup` | 1 | `+1`/`−1`/`0`, from combining ATM CE and PE BUYING/WRITING-DOMINANT interpretations (CE bought or PE written → bullish; CE written or PE bought → bearish) |
| 13 | `straddle_behaviour` | 1.5 | `+1` Directional CE Expansion; `−1` Directional PE Expansion; `0` for both-sides-expanding/weakening or stable/contracting states |
| 14 | `fib_pivot` | — | **Not yet built.** No Fibonacci pivot computation exists anywhere in the codebase today. |
| 15 | `fii_dii_5day` | — | **Not yet wired.** FII/DII data is captured (manual entry) but not yet turned into a 5-day-trend signal for the engine. |
| 16 | `option_premium_vwap` | — | **Deliberately not wired** (user decision, 2026-08-08). Kite's per-leg "VWAP" is actually its `average_price` field, explicitly unverified as true VWAP — wiring it would attach a real score weight to data whose meaning isn't confirmed. |

**Maximum theoretical score** (all 13 wired signals available, every one at its most extreme value, including the big-gap 3-point case): **16.0**. This is a coincidental match to the "16 signals" name — it is the sum of the 13 currently-wired weights (1+1+1+0.5+1+1+3+1.5+1+1+1.5+1+1.5 = 16), not a designed constant. `maxScore` in any real cycle will typically be lower, since not every signal is available every cycle.

## 4. Verdict Thresholds

Applied to `score` only when no override is active (see Section 6):

| Condition | Verdict |
|---|---|
| `score ≥ 14` | Strong Bullish |
| `7.5 ≤ score < 14` | Bullish Biased |
| `−7 < score < 7.5` | Mixed / Sideways (WAIT) |
| `−14 < score ≤ −7` | Bearish Biased |
| `score ≤ −14` | Strong Bearish |

**Disclosed as-is, not corrected:** the neutral/WAIT band is **asymmetric** — it runs from −7 up to (but not including) 7.5, not a symmetric ±7 or ±7.5. This is what the live code does today. Per the hard rule not to change existing verdict logic while building the Outcome Engine, this document records the asymmetry rather than silently smoothing it out. Whether to correct it is a separate decision for the person, not something this document should decide.

## 5. Confidence Formula

```
confidence = "Medium"  if maxScore ≥ 6  AND  |score| ≥ maxScore × 0.7
confidence = "Low"     otherwise
```

Only two tiers exist today — **Medium** and **Low**. There is no "High" tier in the current code, regardless of how strong the score is, as long as it clears the Medium bar. Confidence is deliberately gated on `maxScore` first: even a maximal score is only ever "Low" confidence if fewer than 6 points worth of signals were actually available that cycle.

## 6. Overrides (Separate From Scoring)

Overrides bypass the score-based verdict thresholds entirely and force `Mixed / Sideways (WAIT)`, regardless of score:

1. **First 15 minutes of session** (9:15–9:30 IST) — Override Rule 6.
2. **NIFTY/BankNifty futures OI buildup misalignment** — only checked for NIFTY and BankNifty (Sensex has no second index to align against); fires when one shows Fresh Long Build-up and the other Fresh Short Build-up simultaneously.

**Not yet checked** (disclosed in the code, not implemented): expiry split, gap-fill-in-progress, VIX spike, straddle-expansion, and full 3-index (including Sensex) misalignment overrides.

## 7. Suggested Trade Levels (Risk Engine)

Only computed when the verdict is directional (Bullish or Bearish) **and** a valid ATM premium exists. This is a fixed, disclosed percentage-of-premium rule — not a Haiku-generated or statistically derived number:

```
Entry = current ATM CE (bullish) or PE (bearish) last traded price
SL    = Entry × 0.70   (−30%)
T1    = Entry × 1.50   (+50%, partial booking)
T2    = Entry × 2.00   (+100%, full target)
```

If the ATM premium is 0 or unavailable, no SL/T1/T2 is computed or estimated — the suggestion is marked unavailable instead.

## 8. Display-Only Alerts — Not Part of Scoring

These surface in the UI but do **not** add to `score` or `maxScore`, and are not signals in the 16-signal set above:

- **High-Priority Structure Alert:** fires when cross-expiry ITM alignment (Section 3, signal 8) and the same side's own ATM premium range position (near/at PDH or PDL) are both extreme simultaneously. Purely a visual banner.
- **BankNifty Round-Number + ATM OI Combo Alert:** fires when BankNifty is within 0.15% of a 1000-point level and ATM OI buildup is detected. Shows CE/PE bias with a caution marker; does not alter score or verdict.

## 9. Known Limitations / Provisional Flags

- All specific numeric thresholds in this document (0.1% VWAP band, PCR 1.2/0.8, gap 0.8%, SL/T1/T2 percentages, confidence's 6-point/70% bar, 1000-level BankNifty band) are **PROVISIONAL** — chosen for reasonableness, not backtested against historical outcomes. The Validation/Outcome Engine (built 2026-08-08) exists specifically to eventually measure whether these thresholds hold up.
- The verdict-threshold asymmetry (Section 4) is a live discrepancy, disclosed rather than silently fixed.
- 3 of the 16 documented signals are not yet contributing to the score at all (Section 3, rows 14–16).
