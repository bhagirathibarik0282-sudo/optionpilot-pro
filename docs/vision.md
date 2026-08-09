# OptionPilot Pro — Vision Document

**Version:** 1.0 FINAL
**Status:** Approved
**Owner:** Bhagirathi Barik
**Date:** 2026-08-08

---

## Mission

Transform OptionPilot Pro from a passive market-information display into a reliable, explainable AI-powered decision-support engine for Indian index options (NIFTY, Bank Nifty, Sensex) — one that tells the user not just *what* the market is doing, but *why*, using verifiable data and disclosed logic rather than black-box predictions.

## Long-Term Vision

A single mobile-first dashboard that takes a trader from raw market data to a disciplined, evidence-backed trading decision — and over time, from manual research to a system whose historical accuracy has actually been measured. The long-term trajectory is:

**Data Collection → Backtesting → Semi-Automatic Assistance → Automatic Execution**

Each stage only begins once the prior stage has produced enough verified history to justify it. No stage is skipped on the basis of confidence alone.

## Core Objectives

1. **Honesty over completeness.** Every verdict must be traceable to real, live data. A signal that cannot be computed is marked unavailable — never estimated or guessed.
2. **Explainability.** Every verdict is accompanied by a plain-language explanation of *why*, generated only from the same data the deterministic engine already used — never an independent AI judgment.
3. **Deterministic decisions, AI explanations.** The rule engine (not the AI layer) always decides the verdict, score, and any suggested trade levels. The AI layer (Haiku) explains; it never decides.
4. **Progressive reliability.** Move from a display tool to a decision-support tool to (eventually) a backtested, semi-automated assistant — only as each layer earns that trust through real market confirmation.
5. **Mobile-first, non-technical usability.** The primary user does not write code or manage servers. Every workflow must be usable end-to-end from a phone.

## Problems to Solve

- Raw option-chain and OI data is hard to read quickly under time pressure while trading.
- Existing tools show data but not a synthesized, confidence-rated verdict.
- Manual cross-checking of PCR, OI buildup, walls, straddle behaviour, and cross-expiry alignment is slow and error-prone to do by eye, especially across three indices at once.
- There is no institutional memory: past verdicts and outcomes are not systematically recorded, so trading decisions cannot be improved from experience.
- Automated systems risk fabricating confidence on incomplete or stale data; this project treats that as a safety problem, not a UX inconvenience.

## Target User

A retail Indian index-options trader (option buying, trend-following, swing and select intraday setups) who:
- Trades primarily from a mobile phone.
- Is not comfortable with code, command-line tools, or manual API configuration.
- Wants a second opinion grounded in real data, not a black-box signal.
- Is building trading discipline and wants a system that enforces it (SL/target discipline, verdict traceability, historical review).

## Core Principles

- **No fabricated confidence.** If a signal's data is stale, missing, or unverified, the system says so — it does not fill the gap with a plausible-sounding guess.
- **Separation of decision and explanation.** The rule engine decides. The AI (Haiku) explains an already-made decision and is not permitted to alter verdict, score, or levels.
- **Disclosed formulas only.** Any calculated level (SL, target, thresholds) is either taken from an agreed, documented formula, or explicitly marked as not yet defined — never silently invented.
- **Cost-aware AI use.** AI calls are gated (e.g. only on verdict change or after a time window) — the system does not spend AI cost on redundant recomputation.
- **Credential safety.** No credential (Kite, Google, or otherwise) is ever automated around; reconnection is always a manual, user-initiated action.
- **One reliable step at a time.** Features are built, verified (syntax and, separately, live-market), and shipped incrementally — not in large unverified batches.

## Scope

- NIFTY, Bank Nifty, and Sensex index options (option buying focus).
- Live market data via Zerodha Kite (the current live-data source; expansion to other brokers, if any, is a future Architecture-document decision, not a Vision-stage commitment).
- A deterministic, disclosed rule engine producing a verdict, confidence, and (where available) a suggested trade with SL/T1/T2. (The confidence formula itself is intentionally not defined here — it belongs in the Scoring Rules document.)
- An AI (Haiku) layer that explains — but does not compute — verdicts.
- A daily journal / historical record of verdicts and market conditions.
- Manual FII/DII data entry integrated into the signal set.
- System health and recovery visibility for the underlying data pipeline.

## Out of Scope

- Fully automatic order placement or execution (until the Backtesting and Semi-Automatic stages have been completed and verified).
- Finnifty or any instrument beyond NIFTY, Bank Nifty, and Sensex.
- Any AI-generated verdict, score, or trade level that was not first produced by the deterministic rule engine.
- Automated credential renewal (Kite/Google login) without explicit user action.
- Speculative signals built on data sources whose reliability has not been verified (e.g. unverified "VWAP" proxies) — these stay excluded until disclosed and approved.

## Success Criteria

- Every signal shown on the dashboard is either live-verified against real market data or explicitly labeled as not yet available — with zero fabricated values.
- The rule engine's signal coverage approaches the full documented signal set, each one traceable to a real computation.
- Verdicts and their AI explanations are reproducible: the same underlying data always produces the same verdict.
- A running history of verdicts vs. actual market outcomes exists and can be reviewed (the foundation for backtesting).
- The user can operate the entire system — review, trade, and provide feedback — from a mobile phone without needing to read or edit code.

## Future Direction

- Complete the remaining signals (FII/DII 5-day trend, Fibonacci pivots) once their data sources are confirmed reliable.
- Build the Backtesting stage: replay recorded verdicts against actual subsequent price action to measure real accuracy per signal and per verdict type.
- Once backtested accuracy is established, introduce Semi-Automatic Assistance (e.g. one-tap trade placement from a verdict the user reviews and approves).
- Only after Semi-Automatic Assistance has a proven track record does Automatic Execution become a candidate — gated on demonstrated, measured reliability, not on confidence alone.
