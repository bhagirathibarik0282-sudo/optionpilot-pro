# OptionPilot Pro — System Architecture Document

**Version:** 1.0 Draft for review
**Owner:** Bhagirathi Barik
**Date:** 2026-08-08
**Reference:** docs/vision.md

---

## 1. System Overview

OptionPilot Pro is structured as a pipeline: raw market data flows through validation, feature extraction, and a set of purpose-built engines, until it reaches a single deterministic decision, which is then explained (never altered) by an AI layer and recorded for future reference.

The guiding rule from the Vision document governs every layer below: **deterministic engines decide, the Haiku layer only explains, and no layer is permitted to present stale or fabricated data as if it were current and real.**

Not every layer described here exists yet. This document defines the target architecture; the honest, current build status of each layer is marked explicitly so the document stays trustworthy as the system grows.

```
Market Data Sources
      │
Data Ingestion
      │
Data Validation
      │
Feature Extraction
      │
Indicator / Signal Engine
      │
Scoring Engine ──────► Market Regime Engine
      │                       │
      │                Probability Engine
      │                       │
      ▼                Strategy Engine
Decision Engine ◄─────────────┘
      │                       │
      │                 Risk Engine
      ▼
Haiku Explanation Layer
      │
      ├──────► Validation / Outcome Engine
      │
      ├──────► Historical Journal
      │
      ▼
Dashboard / UI
```

---

## 2. Layer Architecture — Status Summary

| # | Layer | Status |
|---|---|---|
| 1 | Market Data Sources | Built |
| 2 | Data Ingestion | Built |
| 3 | Data Validation | Built |
| 4 | Feature Extraction | Built |
| 5 | Indicator / Signal Engine | Built (14 of 16 documented signals wired) |
| 6 | Scoring Engine | Built |
| 7 | Market Regime Engine | Not yet built |
| 8 | Probability Engine | Not yet built |
| 9 | Strategy Engine | Not yet built (fixed single-strategy rule only) |
| 10 | Risk Engine | Partially built (SL/T1/T2 formula only; no position sizing) |
| 11 | Decision Engine | Partially built (verdict + override logic exists; not a separated module) |
| 12 | Haiku Explanation Layer | Built |
| 13 | Validation / Outcome Engine | Not yet built |
| 14 | Historical Journal | Built |
| 15 | Dashboard / UI | Built |

---

## 3. Component Responsibilities

### 3.1 Market Data Sources
- **Purpose:** Supply all raw external data the system depends on.
- **Inputs:** None (external boundary).
- **Outputs:** Live quotes, option chains, futures data, OHLC (Zerodha Kite); manually entered FII/DII figures (user, via Paste & Fill).
- **Dependencies:** Zerodha Kite API/session; user-entered data has no automated source.
- **Data flow:** → Data Ingestion.
- **Failure handling:** A lost Kite session or missing FII/DII entry is a source-level failure, surfaced by the Recovery Engine, not silently substituted.

### 3.2 Data Ingestion
- **Purpose:** Pull raw data from sources into the system on a fixed cadence.
- **Inputs:** Kite REST/WebSocket responses; manual FII/DII form submissions.
- **Outputs:** Raw per-symbol snapshots (NIFTY/BANKNIFTY/SENSEX) with a receipt timestamp.
- **Dependencies:** Kite session (OAuth), instruments cache, rate-limit-aware batching/retry.
- **Data flow:** Market Data Sources → Data Ingestion → Data Validation.
- **Failure handling:** Rate-limit (429) responses are retried with backoff; a broken session routes to Recovery Engine as `MANUAL_ACTION_REQUIRED` (credential renewal is never automated).

### 3.3 Data Validation
- **Purpose:** Confirm incoming data is present, fresh, and internally consistent before anything downstream trusts it.
- **Inputs:** Raw snapshots from Data Ingestion.
- **Outputs:** A pass/fail verdict per signal (`OK` / `NULL` / `STALE` / `NOT_AVAILABLE`), with an overall validity flag.
- **Dependencies:** Per-index freshness threshold; per-signal null checks.
- **Data flow:** Data Ingestion → Data Validation → Feature Extraction (only for validated data).
- **Failure handling:** Anything not `OK` is excluded from scoring, not estimated. Downstream layers only ever see explicitly validated values.

### 3.4 Feature Extraction
- **Purpose:** Turn raw fields (LTP, OI, volume, timestamps) into the derived quantities the signal engine needs — PCR, gap %, range position vs. PDH/PDL, OI-buildup direction, etc.
- **Inputs:** Validated raw snapshot.
- **Outputs:** Derived features per symbol/strike/expiry.
- **Dependencies:** Data Validation output only (never raw, unvalidated data).
- **Data flow:** Data Validation → Feature Extraction → Indicator/Signal Engine.
- **Failure handling:** A feature that cannot be derived (e.g. missing OI history for a direction comparison) is passed downstream as unavailable, not defaulted.

### 3.5 Indicator / Signal Engine
- **Purpose:** Compute each of the documented signals (futures VWAP, PDH/PDL, OI PCR, Max Pain, India VIX, futures OI buildup, gap type, cross-expiry ITM alignment, sector heatmap breadth, PCR trend/divergence, call/put wall alignment, ATM OI buildup, straddle behaviour, and NIFTY/BankNifty futures alignment as an override).
- **Inputs:** Extracted features.
- **Outputs:** A directional value (+1/0/−1, or a weighted equivalent) per signal, or `null` if the signal's own preconditions aren't met.
- **Dependencies:** Feature Extraction; some signals depend on stateful trackers (price/OI direction history) that must be computed exactly once per refresh cycle to avoid self-corruption.
- **Data flow:** Feature Extraction → Indicator/Signal Engine → Scoring Engine.
- **Failure handling:** An unwired or data-insufficient signal returns `null` and is excluded from the score entirely — it does not silently count as neutral.

### 3.6 Scoring Engine
- **Purpose:** Combine all available signal values into a single weighted score and a verdict.
- **Inputs:** Signal values from the Indicator/Signal Engine.
- **Outputs:** Score, max achievable score (given how many signals are actually available), confidence tier, verdict label, and any active overrides.
- **Dependencies:** Indicator/Signal Engine; documented per-signal weights.
- **Data flow:** Indicator/Signal Engine → Scoring Engine → Decision Engine.
- **Failure handling:** If too few signals are available, confidence is downgraded rather than the verdict being presented with false certainty.

### 3.7 Market Regime Engine *(not yet built)*
- **Purpose (target):** Classify the prevailing market condition (trending / ranging / high-volatility / event-driven) so downstream engines can weight signals contextually.
- **Inputs (target):** Scoring Engine output, VIX, historical range data.
- **Outputs (target):** A regime label.
- **Dependencies (target):** Sufficient historical data to define regime thresholds.
- **Data flow (target):** Scoring Engine → Market Regime Engine → Strategy Engine.
- **Failure handling (target):** Absent regime data defaults to "regime unknown," never to an assumed regime.

### 3.8 Probability Engine *(not yet built)*
- **Purpose (target):** Attach a measured, backtested probability to a given verdict, based on historical outcomes of similar setups.
- **Inputs (target):** Historical Journal + Validation/Outcome Engine records.
- **Outputs (target):** A probability/confidence figure grounded in actual past performance, not a heuristic.
- **Dependencies (target):** A working Validation/Outcome Engine with enough recorded history.
- **Data flow (target):** Historical Journal → Probability Engine → Strategy Engine / Decision Engine.
- **Failure handling (target):** Until enough history exists, this layer reports "Historical Support: DATA UNAVAILABLE" rather than a fabricated probability — this is already the documented behaviour of the current Decision layer.

### 3.9 Strategy Engine *(not yet built)*
- **Purpose (target):** Select among multiple possible trade structures (not just the current single ATM CE/PE buy) based on regime, probability, and verdict.
- **Inputs (target):** Market Regime Engine, Probability Engine, Scoring Engine.
- **Outputs (target):** A chosen strategy type and its parameters.
- **Dependencies (target):** Market Regime Engine, Probability Engine.
- **Data flow (target):** → Strategy Engine → Risk Engine → Decision Engine.
- **Failure handling (target):** No qualifying strategy → no trade suggestion, not a forced default.
- **Current state:** The system today only ever proposes a single fixed structure — ATM CE or PE in the direction of the verdict — computed directly inside the Scoring Engine's output, not by a separate Strategy Engine.

### 3.10 Risk Engine *(partially built)*
- **Purpose:** Determine position sizing and exit levels for a proposed trade.
- **Inputs:** Suggested entry (current ATM premium).
- **Outputs:** SL, T1 (partial), T2 (full) — currently a fixed, disclosed percentage-of-premium formula (SL = Entry −30%, T1 = +50%, T2 = +100%).
- **Dependencies:** Entry price only, today; position-sizing/account-risk logic is not yet built.
- **Data flow:** Scoring Engine output → Risk Engine → Decision Engine.
- **Failure handling:** If entry premium is zero/unavailable, no SL/T1/T2 is computed or guessed — the suggestion is marked unavailable.

### 3.11 Decision Engine *(partially built)*
- **Purpose:** Produce the single, final, presentable verdict — combining score, overrides, and (in future) regime/strategy/risk output.
- **Inputs:** Scoring Engine output, override checks (e.g. first-15-minutes rule, NIFTY/BankNifty futures misalignment).
- **Outputs:** Final verdict, confidence, and trade suggestion.
- **Dependencies:** Scoring Engine; override rules.
- **Data flow:** Scoring Engine → Decision Engine → Haiku Explanation Layer + Dashboard/UI.
- **Failure handling:** Any active override forces a WAIT verdict rather than presenting a directional call the system isn't confident in.
- **Current state:** This logic lives inside the rule-engine function today rather than as a physically separate module; it is functionally present but not yet architecturally isolated.

### 3.12 Haiku Explanation Layer
- **Purpose:** Turn an already-decided verdict into a short, plain-language explanation for the user.
- **Inputs:** Verdict, score, signal contributions, overrides, and suggestion — all already computed by the Decision Engine.
- **Outputs:** A 2–3 sentence explanation.
- **Dependencies:** Anthropic API (server-side only; the key never reaches the browser); a cost-guard cache keyed by symbol.
- **Data flow:** Decision Engine → Haiku Explanation Layer → Dashboard/UI.
- **Failure handling:** Haiku is never called when the verdict is unavailable (stale/invalid data); the layer is skipped, not guessed around. Haiku is also gated to fire only on verdict change or after 15 minutes, and is contractually forbidden from altering the verdict/score/levels it's given.

### 3.13 Validation / Outcome Engine *(not yet built)*
- **Purpose (target):** Compare each recorded verdict against what the market actually did afterward, to measure real signal and verdict accuracy.
- **Inputs (target):** Historical Journal entries + subsequent market data.
- **Outputs (target):** Per-verdict and per-signal accuracy statistics.
- **Dependencies (target):** Historical Journal; a defined outcome-measurement window (e.g. price N minutes/hours after the verdict).
- **Data flow (target):** Historical Journal → Validation/Outcome Engine → Probability Engine.
- **Failure handling (target):** Incomplete outcome windows are excluded from statistics, not interpolated.
- **Why this matters:** This is the current single biggest gap between "Data Collection" (done) and "Backtesting" (the Vision document's next stage) — without it, no probability figure can be honestly claimed.

### 3.14 Historical Journal
- **Purpose:** Record verdicts and market conditions for later review.
- **Inputs:** Decision Engine output, rolling 3M/15M/30M verdicts, an "Important Note" engine.
- **Outputs:** Plain-text and formatted HTML journal entries, archived to Google Drive.
- **Dependencies:** Google Drive OAuth connection.
- **Data flow:** Decision Engine → Historical Journal → Google Drive; Historical Journal → (future) Validation/Outcome Engine.
- **Failure handling:** A failed Drive archive is the one auto-recoverable failure mode in the system (retried with backoff); if Drive isn't connected at all, this is `MANUAL_ACTION_REQUIRED`.

### 3.15 Dashboard / UI
- **Purpose:** Present all of the above to the user on a mobile-first interface.
- **Inputs:** Live data (all layers), validation status, verdicts, explanations, system health.
- **Outputs:** Rendered cards, alerts, and tabs (Overview, Futures, Options, Alignment, Verdict, System, etc.).
- **Dependencies:** All upstream layers; degrades gracefully when any of them report unavailable data.
- **Data flow:** All layers → Dashboard/UI (read-only; the UI does not feed back into scoring).
- **Failure handling:** Missing/stale data is displayed as explicitly missing/stale — never hidden or replaced with a plausible-looking placeholder.

---

## 4. Data Flow Summary

1. **Market Data Sources** push raw quotes/chains/FII-DII data into **Data Ingestion**.
2. **Data Validation** accepts or rejects each field for freshness and completeness.
3. **Feature Extraction** derives the working quantities (PCR, gap %, range position, etc.) from validated data only.
4. The **Indicator/Signal Engine** turns features into directional signal values.
5. The **Scoring Engine** combines available signals into a score, confidence, and verdict.
6. *(Target)* The **Market Regime Engine**, **Probability Engine**, and **Strategy Engine** would add context, historical grounding, and trade-structure selection.
7. The **Risk Engine** attaches SL/T1/T2 to any suggested trade.
8. The **Decision Engine** finalizes the verdict, applying overrides.
9. The **Haiku Explanation Layer** explains — never edits — that decision.
10. The **Historical Journal** records the decision for later review; the *(target)* **Validation/Outcome Engine** will eventually score it against real outcomes.
11. The **Dashboard/UI** renders all of the above for the user.

---

## 5. Failure and Recovery Flow

- Every layer treats missing/stale/invalid input as a first-class outcome, not an exception to work around.
- The **Recovery Engine** (Module 13) monitors module health (Truth Engine, Recorder Engine, Google Drive, Daily Journal, Market DNA Engine) independently of the main data pipeline.
- Exactly one failure mode is auto-recoverable today: a failed Google Drive archive (retried with exponential backoff, capped at 5 attempts).
- Every other failure mode — a lost Kite session, a disconnected Google Drive account — is intentionally `MANUAL_ACTION_REQUIRED`: the system will never attempt to log in on the user's behalf.
- A module that recovers on its own is reflected as `RECOVERED`, clearing any prior manual-action flag rather than leaving stale alerts behind.

---

## 6. AI Boundary

The Haiku Explanation Layer operates under a hard boundary, enforced structurally, not just by convention:

- It receives the verdict, score, signal contributions, overrides, and suggested trade **after** the Decision Engine has already finalized them.
- It is prompted explicitly not to change any of those values — only to explain them.
- It runs **server-side only**; the API key never reaches the client, and the client cannot call the AI provider directly.
- It is **cost-guarded**: called only on a verdict change or after a 15-minute window, never on every data refresh.
- It is **skipped entirely** when the underlying data is invalid or stale — there is no "explain anyway" path.

No other AI involvement exists anywhere else in the pipeline today. If future engines (e.g. Probability Engine) ever incorporate a model-based estimate, that estimate must be clearly labeled as such and kept separate from the deterministic score, per the Vision document's core principles.

---

## 7. Future Extensibility

- **Broker abstraction:** Data Ingestion is designed around Kite today, but the layer boundary (raw external data → validated internal snapshot) is where a future second broker/data source would plug in, without requiring changes to any layer above Data Validation. No such abstraction is implemented yet — this is a placeholder for future architecture work, not a current capability.
- **Additional signals:** The Indicator/Signal Engine is built to accept new signals independently (each with its own validation, weight, and null-handling) — the remaining two documented signals (FII/DII 5-day trend, Fibonacci pivot) slot into the same pattern already used for the 14 that exist.
- **Regime/Probability/Strategy/Risk maturity:** These layers are designed for but not yet implemented; each depends on the Validation/Outcome Engine existing first, since none of them can be built honestly without measured historical accuracy to ground them.
- **Multi-user/shared deployments:** Not addressed by this architecture; today's system assumes a single user's Kite/Google credentials.
