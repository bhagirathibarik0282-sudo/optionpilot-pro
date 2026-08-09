# Premium Decay & Moneyness — Research Note (Zerodha Varsity-grounded)

**Purpose:** Ground the earlier Premium Decay examination (docs/premium-decay-examination-report.json) against Zerodha Varsity's own Options Theory material — the same educational source millions of Indian traders (including Kite users) learn from — so any future implementation uses definitions and formulas consistent with what the person already trusts and half-remembers from Varsity, not a competing convention.

**Sources:** Zerodha Varsity, Module 5 "Options Theory for Professional Trading" — chapters on Theta and Moneyness of Options (zerodha.com/varsity/chapter/theta-2/, zerodha.com/varsity/chapter/moneyness-of-option/). Reproduction of Varsity's own material/text/images is restricted by Zerodha's own copyright notice on those pages; everything below is paraphrased in original wording, not copied.

---

## 1. What Varsity teaches about Theta (time decay)

- All options lose value as expiration approaches, and theta is the rate of that value loss per day, all else held equal.
- Premium is made up of two parts — intrinsic value plus time value — and, all else equal, an option loses some value every single day purely because of theta.
- Time decay is not linear across the life of a contract: early in a series, with many days left, an option barely loses value day to day, but as expiry nears the decay accelerates sharply. Varsity's own illustration: at 120 days to expiry an option was priced around 350, but by 100 days to expiry (just 20 days later) it had only fallen to around 300 — a small move for a large chunk of calendar time, which is the "flat" early part of the curve this conversation already discussed.
- A short (seller) position benefits from theta, since the seller's whole objective is to hold and pocket premium while it erodes, in their favour, every day.
- Consequence Varsity draws explicitly, worth carrying into any dashboard feature: writing early in a series pockets a large time-value premium but the daily erosion is slow; writing close to expiry starts from a much smaller premium but it erodes fast. The mirror image of this — from a *buyer's* seat, which is this person's actual side — is exactly what makes a fresh monthly (many days left) a structurally gentler entry than the last week of the same contract, independent of any directional view.
- Indian index options are **European-style**: a buyer cannot exercise early, only square off the position before expiry or let it settle at expiry — confirmed directly by Varsity's own author in the page's comment thread. This matters for any "days-to-expiry" calculation: there is no early-exercise complication to model.

## 1.5 What Varsity teaches about Vega and IV crush — the THIRD source of premium loss

This is the piece that most retail traders conflate with theta, and it directly matters for a 700–900 premium contract:

- Vega measures how much an option's premium moves for each 1-point change in implied volatility (IV) — independent of whether the underlying spot moves at all.
- Delta and Gamma affect the **intrinsic** portion of a premium (they're driven by spot movement); Theta and Vega affect the **extrinsic/time** portion — this exact split was directly confirmed by Varsity's own author in the Vega chapter's comment thread, correcting a reader's question.
- Around known events (RBI policy, Union Budget, election results, a company's own earnings for stock options), IV typically rises beforehand as the market prices in uncertainty, then collapses sharply afterward once the event resolves — this collapse is commonly called "**IV crush**." A premium can fall sharply on IV crush alone, even with zero net theta decay and even if the underlying moved in the buyer's predicted direction, because the vega-driven loss can outweigh the delta-driven gain.
- Practical implication for a 700–900 ITM premium: a drop in that premium over a few days could be theta (expected, time-based), vega/IV crush (event-driven, can be sudden and large), intrinsic loss (spot moved against the position), or some mix of all three — and **without decomposing the premium change, these three look identical on a raw price chart**. This is the strongest additional argument, beyond the earlier intrinsic/extrinsic split, for why a "why did my premium move" feature needs all three pieces (intrinsic Δ, theta Δ, vega Δ) rather than just intrinsic vs. extrinsic.

## 2. What Varsity teaches about Moneyness (ITM / ATM / OTM) and Intrinsic Value

Varsity's own definitions, exactly as they'd appear in the option chain:

- Intrinsic value is the amount an option buyer would actually make if they exercised the contract right now, and it can never be negative — it's a non-negative value only.
- For a call option, intrinsic value = Spot Price − Strike Price. For a put option, intrinsic value = Strike Price − Spot Price.
- Any option carrying intrinsic value is classified In the Money (ITM); any option with none is Out of the Money (OTM); a strike close to spot is At the Money (ATM).
- For calls, every strike below the ATM strike is ITM and every strike above it is OTM; for puts it's the reverse — strikes above ATM are ITM, strikes below are OTM.
- When intrinsic value is very large the option is called Deep ITM; when intrinsic value is minimal the option (on the opposite side) is called Deep OTM.
- ITM premiums are always higher than OTM premiums for the same underlying and expiry, because ITM already carries intrinsic value on top of whatever time value remains.
- On a buyer's terminal outcome: asked directly in the comments whether an option should finish ATM or OTM to be profitable for a buyer, Varsity's author corrected the questioner — it should expire ITM for the buyer to have actually gained anything.

## 3. Cross-reference against the OptionPilot Pro codebase (verified 2026-08-09)

| Varsity concept | Status in server.ts |
|---|---|
| Premium = Intrinsic + Time value | **Missing.** Neither term is computed; PremiumData has no intrinsic/extrinsic split at all. |
| Intrinsic value formula (Spot−Strike for CE, Strike−Spot for PE) | **Missing**, but trivial to add — spot and strike are both already available on every PremiumData record. |
| ITM / ATM / OTM classification | **Partially present.** Only `isAtm: boolean` exists; there's no `isItm`/`isOtm` flag, though it's derivable from the (missing) intrinsic value calculation above. |
| Theta (instantaneous decay rate) | **Present.** `calcGreeks()` computes a full Black-Scholes theta per leg, already matching Varsity's definition of theta as "value lost per day." |
| Non-linear decay curve / acceleration near expiry | **Not surfaced.** The underlying Black-Scholes math already implies this (theta grows as time-to-expiry shrinks), but nothing in the code tracks theta *over time* or flags that decay is accelerating — it's read fresh each cycle as a snapshot, never compared to its own recent history. |
| European-style, no early exercise | Confirmed as already correctly assumed throughout (no exercise-related logic anywhere, consistent with NSE index options). |
| Days to expiry feeding the Black-Scholes T term | **Present, but calendar-day only** (`(expiryDate − now) / 86,400,000ms`), not trading-day aware — already flagged in the earlier examination report as a gap, and Varsity's own worked examples also use plain calendar-day-based T, so this is a reasonable, textbook-consistent simplification, not an error. The earlier report's recommendation to add trading-day awareness remains a worthwhile *refinement*, not a correction. |

## 4. Refined recommendation (adds precision to the earlier examination report, changes nothing else)

The earlier examination report's Step 2 ("add intrinsic/extrinsic value computation") can now be specified exactly, using Varsity's own formulas directly:

```
intrinsicValue(CE) = max(spot - strike, 0)
intrinsicValue(PE) = max(strike - spot, 0)
extrinsicValue     = premium - intrinsicValue
isItm              = intrinsicValue > 0
```

This is a direct, citable, textbook-grounded formula — not a guess — and it's the single highest-value, lowest-risk addition from both the earlier examination and this research pass, because it's the one piece of missing math that would have prevented the exact confusion this whole conversation started from: a large ₹ premium (700–900) looking identical on the dashboard whether it's mostly intrinsic (ITM, low decay risk) or mostly time value (ATM, full decay exposure).

**Extended, three-way decomposition (from section 1.5's Vega/IV-crush finding):** a genuinely complete "why did this premium move" answer needs to separate three effects, not two:

```
change in intrinsic value  → driven by spot movement (delta/gamma)
change from theta          → expected, time-based decay (already computed via calcGreeks)
change from vega/IV shift  → event-driven, can be large and sudden (IV is already computed via calcImpliedVolatility)
```

All three inputs (intrinsic formula, existing theta, existing vega × ΔIV) are already available or trivially addable — this decomposition doesn't require any new data source, only combining pieces that already exist separately in the codebase.

## 5. What this research does NOT change

- Does not alter the earlier report's finding that a real holiday list (Step 1) is the blocking prerequisite for trading-day-aware calculations.
- Does not introduce any new "engine" — Varsity's own framing (Theta, Moneyness, Intrinsic/Time value) maps cleanly onto Feature Extraction-level calculations, consistent with the earlier architecture recommendation.
- Does not change the AI boundary — none of this is Haiku's job to compute; it would only ever explain an already-computed intrinsic/extrinsic split, same as every other deterministic signal in this system.
