# OptionPilot Pro — Final Canonical Architecture Freeze V2

Status: DESIGN_FREEZE / SHADOW_ONLY
Purpose: prevent duplicate authority, divergent Dashboard/Telegram/Kite state, stale-data promotion, and unsafe execution enablement.

## 1. Non-negotiable source policy
- Every received Kite WebSocket packet is raw live-market evidence for subscribed instruments; do not use generic TBT wording as a substitute for the actual received-packet contract.
- Kite instrument master is the sole contract/token/expiry/strike/lot-size identity source.
- Kite order updates are execution truth only after a separately approved live-execution stage.
- No module may fabricate, interpolate, or independently reconstruct a live tradable fact.
- Railway deployment is outside this PR and remains unchanged.

## 2. One-roof market snapshot
Every live observation belongs to one canonical identity and must retain:
- snapshotId
- symbol/session identity
- connectionId
- instrumentMasterVersion
- exchangeTimestamp
- receivedAt
- processedAt
- ingestSeq
- provenance (`KITE_WS`, `KITE_INSTRUMENT_MASTER`, `LOCAL_DERIVED`)
- source time range where a component is derived from a window
- minute-close status

Required evidence slots:
1. market structure
2. futures confirmation
3. option premiums
4. OI/positioning (PCR/walls where available)
5. multi-DTE
6. volatility/IV/Greeks where supported
7. heavyweights
8. sector breadth
9. response ladder (1m/3m/6m/15m/30m)
10. liquidity/executability

Heavyweights and sector breadth are separate mandatory evidence families. Neither is candidate authority.
A valid observation is recordable even when strict filtering is not ready. Missing/late evidence never erases observed market truth.

## 3. Freshness and quality
- There is no universal production freshness value such as 90 seconds.
- Freshness is family-specific and must be calibrated from observed live behaviour.
- Until a required family has a calibrated budget, the snapshot state is `SHADOW_UNCALIBRATED` and new entries are blocked.
- Stale/future/duplicate/invalid-timestamp/devil-flagged evidence fails closed for candidate promotion.
- Internal blockers remain auditable; user-facing language stays action-oriented.

## 4. Tick ingestion, backpressure and processing separation
Kite WebSocket packet -> fast ingest queue -> canonical raw state.
Processing, recording and UI rendering are separate consumers.
- WebSocket callback must not perform heavy calculations or blocking persistence.
- Every received packet must retain exchange/receive/process timing and ingest sequence.
- Queue depth, queue lag, dropped-packet count and backpressure state are telemetry, not UI decoration.
- Backpressure or packet drop means `BLOCK_NEW_ENTRIES`; raw observation remains recordable.
- Dashboard may batch visual refreshes while backend retains received-packet truth.

## 5. Recorder contract
- Raw received packets are append-only audit truth.
- Every completed 1-minute snapshot becomes immutable historical evidence.
- 3m/6m/15m/30m are analysis windows, not feed refresh intervals.
- Later outcome analysis is separate and never rewrites the original decision/state.
- Rejected/no-trade states are first-class journal records.

## 6. Deterministic authority chain
Kite WebSocket packet -> raw evidence -> canonical snapshot -> freshness gates -> independent Buyer/Seller interpretation -> hard eligibility -> `EXECUTION_CANDIDATE_SELECTOR_V2` -> dynamic risk lifecycle -> immutable locked trade packet -> Dashboard + Telegram + Kite-shadow + Recorder/Journal.

Exactly one deterministic hard candidate authority exists.
No Dashboard, Telegram formatter, journal, AI layer, quantum layer or Kite adapter may independently select, re-rank or reconstruct a candidate.

## 7. Buyer/Seller interpretation
Buyer and Seller are independent deterministic interpretations.
- Buyer absent does not imply Seller.
- Seller absent does not imply Buyer.
- Missing required evidence blocks promotion instead of inventing a side.
- Valid neutral language: Buyer advantage not established / Seller advantage not established / wait for named confirmation.

## 8. Final locked trade packet
One authoritative packet feeds all downstream consumers. It must bind at minimum:
- decisionId
- snapshotId
- candidateKey
- symbol
- option side (CE/PE)
- strike
- expiry
- DTE
- moneyness
- reference premium
- quantity/lot intent
- dynamic risk/SL/TSL/target policy reference
- selector version/reasons
- freshness timestamp
- locked packet hash

An idempotency ledger must ensure one decisionId cannot generate duplicate candidate transport or duplicate order intent.
OPTION_BUYER includes both CE buying and PE buying. Legacy directional SELL labels must never convert PE buying into a seller/business role.

## 9. Consumer equality rule
The exact same locked candidate identity must be used by:
- Dashboard highlighted candidate
- Telegram candidate message
- Kite-shadow order intent
- Recorder/journal

Formatting may differ, identity may not. Consumers must never reconstruct or re-rank the candidate.
Any identity/freshness/hash mismatch blocks Telegram transport and Kite-shadow execution.
Telegram remains buyer-candidate transport only; it cannot authorize a trade.

## 10. Execution safety and truth
Real-money Kite submission is disabled in this V2 correction stage.
Shadow lifecycle contract:
Signal -> candidate lock -> risk gate -> execution eligibility -> shadow order intent -> acknowledgement/reject simulation or broker-observation receipt -> position lifecycle -> SL/TSL/exit -> P&L journal.

Store separately:
- decision/reference price
- intended/submitted order details
- acknowledgement/rejection state
- actual fill price when a real broker-observation source exists
- slippage
- realized/unrealized P&L

All receipts return to the same decisionId. Duplicate/replayed decisions fail closed. Dynamic risk lifecycle is authoritative; fixed point SL/target values are not live authority.

## 11. NIFTY/SENSEX exclusivity
The hard eligibility/risk boundary must preserve index exclusivity: an active eligible trade lifecycle in one of NIFTY or SENSEX blocks a competing new live-authority lifecycle in the other. Quantum may inspect this only in shadow research.

## 12. Dashboard freeze
Dashboard is projection/display only. It may not alter evidence, score, candidate identity, risk, Telegram permission or execution authority.
Business views may separate Buyer and Seller interpretation, but both must project deterministic upstream truth.

## 13. Intelligent journal and evidence memory
Automatic event/minute records include what changed, Buyer/Seller behaviour, premium behaviour, heavyweight and sector-breadth context, candidate considered, pass/reject/no-trade reason, Telegram status, execution status and later outcome annotation.
Closed 1-minute states are same-day historical evidence immediately. Historical similarity provides context/confidence only and cannot override current hard-selector authority.

## 14. Haiku / AI boundary
Haiku may explain, summarize, journal, format and name missing confirmation.
Haiku/AI may never change:
- BUY/BLOCK
- CE/PE
- strike/expiry/DTE
- decisionId/candidateKey
- entry/risk/SL/TSL/quantity
- eligibility/selector result
- Telegram authorization
- Kite authorization

## 15. Quantum boundary
Quantum/QUBO is `SHADOW_RESEARCH_ONLY`.
It may compare only candidates that have already passed hard deterministic eligibility and may inspect DTE/strike alternatives, premium response, liquidity/spread, theta/IV burden, 3m/6m/15m/30m stability, candidate churn and NIFTY/SENSEX exclusivity.
It cannot promote, send, authorize risk, or execute.

## 16. Build order — frozen chain
A. PR #304 V2 one-roof snapshot contract
B. Existing live-source adapters into the envelope, including verified heavyweight and sector-breadth adapters
C. Deterministic live business-evidence producer
D. Exact hard selector + canonical buyer packet
E. Locked trade-packet hash + idempotency ledger
F. Dashboard/Telegram/Kite-shadow consumers from the exact same packet
G. Intelligent journal + immutable minute evidence
H. Evidence-memory comparisons
I. Shadow quantum comparison
J. Shadow execution/P&L verification
K. Only after all gates pass: separate explicit user decision on real-money enablement, merge/deployment and Railway work

## 17. Devil-check gates for every PR
Reject a change if any answer below is yes:
- Did it create a second candidate authority?
- Can stale/uncalibrated/backpressured data reach candidate transport or execution?
- Can UI/AI/quantum alter the locked candidate?
- Can recorder failure erase market truth or silently rewrite a decision?
- Can Dashboard/Telegram/Kite-shadow disagree on candidate identity?
- Are unverified heavyweight/sector facts fabricated?
- Are research-only outputs promoted into live authority?
- Is real-money Kite submission enabled?
- Is Railway touched, deployed, or merged without explicit user approval?

Final Deep Research verdict: **MODIFY, then GO for live-market shadow testing. Do not enable real-money execution yet.**

Branding: OPTIONPILOT PRO™ / OPTIONPILOT EDGE™ — Exclusively Designed by Bhagirathi Sir.
