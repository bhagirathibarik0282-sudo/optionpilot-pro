# JEV_DECISION_SHADOW_V1

Purpose: test whether Jev adds measurable option-buyer value before it receives any production authority.

## Frozen model and API

- Model: `typesafe/jev-1.13`
- OpenRouter Decisions endpoint: `https://openrouter.ai/api/alpha/decisions`
- Maximum batch: 20 decision-time samples
- API is alpha; pin the model and keep the adapter isolated.

## Input policy

Every sample must contain only information that existed at the decision timestamp:

- exact option candidate identity (symbol, side, strike, expiry, DTE, moneyness)
- current premium and existing deterministic candidate gates
- canonical evidence envelope already produced by OptionPilot
- no future price, outcome, target-hit, MFE, MAE, P&L, or later-session evidence

The authoritative selector result is retained separately for comparison but is never included in Jev's state. This prevents Jev from copying the existing selector decision.

## Jev questions

For each exact candidate:

1. TAKE_CANDIDATE vs NO_TRADE
2. evidence internally consistent? (noul)
3. material blocking conflict? (noul)
4. candidate quality score

These are research labels only.

## Authority boundary

`JEV_DECISION_SHADOW_V1`:

- does not change verdict
- does not change `EXECUTION_CANDIDATE_SELECTOR_V2`
- does not create or rank a canonical candidate
- does not change Telegram eligibility
- does not affect Kite shadow/live execution
- creates no broker orders
- cannot override the canonical selector

## Verification protocol

Freeze the question definitions and model version before evaluating outcomes.

For each untouched sample, persist:

- sampleId / decision timestamp
- canonical selector decision
- Jev answers and probabilities/confidence returned by OpenRouter
- actual later option outcome from PostgreSQL only
- existing lifecycle result / net P&L after charges when available
- DTE bucket
- symbol and side

Compare at least:

- selector alone
- Jev alone (TAKE_CANDIDATE/NO_TRADE research label)
- selector + Jev agreement as a hypothetical filter

Do not call Jev confidence a market win probability until calibration against untouched outcomes demonstrates that relationship.

Promotion requires evidence that the Jev policy improves business metrics on OOS/live-forward samples, including net expectancy and false-entry control, without unacceptable trade suppression or DTE/regime instability.
