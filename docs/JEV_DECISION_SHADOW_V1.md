# JEV_DECISION_SHADOW_V1

Purpose: test whether Jev adds measurable option-buyer value before it receives any production authority.

## Frozen model and API

- Model: `typesafe/jev-1.13`
- OpenRouter Decisions endpoint: `https://openrouter.ai/api/alpha/decisions`
- Maximum batch: 20 decision-time samples
- API is alpha; pin the model and keep the adapter isolated.

## Exact source policy

The primary Jev input source is the already-existing OptionPilot persisted live gate evidence:

- persist kind: `H1_LIVE_GATE_EVIDENCE_PACKET_V1`
- provenance: `LIVE_RUNTIME_EXACT`
- exact candidate identity + deterministic gate values + response metrics + capital/liquidity evidence + policy diagnostics
- the existing `assembleLiveExecutionCandidateInput()` rebuilds the exact `ExecutionCandidateInput`
- the existing `EXECUTION_CANDIDATE_SELECTOR_V2` is rerun only as the separate comparison baseline

For a persisted packet, the assembler is anchored to the packet's own `identity.observedAt`. This preserves decision-time freshness and rejects evidence whose timestamp is later than the candidate decision.

Do **not** fabricate exact Jev samples from old H1 replay rows. The existing reconstruction audit already proves that old replay does not persist every hard-selector gate, so it cannot establish full selector qualification.

## Input policy

Every sample contains only information that existed at the decision timestamp:

- exact option candidate identity (symbol, side, strike, expiry, DTE, moneyness)
- exact existing deterministic candidate gates
- exact live response / liquidity / policy evidence that was persisted with the gate packet
- no future price, outcome, target-hit, MFE, MAE, P&L, or later-session evidence

The authoritative selector result is retained separately for comparison but is never included in Jev's state. This prevents Jev from simply copying the existing selector decision.

Sample IDs are restricted to safe deterministic identifiers so two different records cannot collapse into the same Jev question key.

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
