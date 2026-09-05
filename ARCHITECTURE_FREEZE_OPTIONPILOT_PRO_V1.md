# OptionPilot Pro — Final Canonical Architecture Freeze V1

Status: DESIGN_FREEZE
Purpose: prevent duplicate authority, divergent dashboard/Telegram/Kite state, and unnecessary engine proliferation.

## 1. Non-negotiable source policy
- Kite WebSocket is the primary live market-data source for subscribed instruments.
- Kite instrument master is the contract/token identity source.
- Kite order updates are execution truth.
- No module may fabricate, interpolate, or independently reconstruct a live tradable fact.

## 2. One-roof market snapshot
Every live observation belongs to one canonical identity:
- snapshotId
- observedAt/exchange timestamp where available
- symbol/session identity

Required evidence slots:
1. market structure
2. futures confirmation
3. option premiums
4. OI/positioning (PCR/walls where available)
5. multi-DTE
6. volatility/IV/Greeks where supported
7. heavyweights
8. sector/market breadth
9. response ladder (1m/3m/6m/15m/30m)
10. liquidity/executability

A valid observation is recordable even if filtering is not ready. Missing/late evidence never erases the observed market truth.

## 3. Tick ingestion and processing separation
Kite tick -> fast ingest queue -> canonical raw state.
Processing, recording and UI rendering are separate consumers.
- WebSocket callback must not perform heavy calculations or blocking persistence.
- Tick truth has priority over UI animation.
- Dashboard may batch visual refreshes while backend retains all received ticks.
- Queue lag/backpressure must be monitored.

## 4. Recorder contract
- Raw received ticks are append-only audit truth.
- Every completed 1-minute snapshot becomes immutable historical evidence.
- 3m/6m/15m/30m are analysis windows, not feed refresh intervals.
- Later outcome analysis must be stored separately and must never rewrite the original decision/state.
- Rejected/no-trade states are first-class journal records.

## 5. Deterministic processing chain
Canonical snapshot -> deterministic calculations -> Buyer/Seller interpretation -> hard eligibility -> hard candidate selector -> risk gate -> final locked trade packet.

No dashboard, Telegram formatter, journal, AI layer or Kite adapter may independently select/re-rank/reconstruct a candidate.

## 6. Buyer/Seller interpretation
Every evidence family should express Buyer Support and Seller Support where derivable.
User-facing language must be action-oriented rather than generic ambiguity labels.
Valid neutral state:
- Buyer advantage not established
- Seller advantage not established
- Wait for the named confirmation condition

Never invent a Seller edge merely because Buyer edge is absent.

## 7. Final locked trade packet
One final authoritative packet feeds all trade consumers. It must bind at minimum:
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
- risk/SL/TSL/target policy reference
- selector version/reasons
- freshness timestamp

OPTION_BUYER includes both CE buying and PE buying. Legacy directional SELL labels must never convert PE buying into a seller/business role.

## 8. Consumer equality rule
The same locked candidate identity must be used by:
- Dashboard highlighted candidate
- Telegram candidate message
- Kite executable order intent
- Recorder/journal

Formatting may differ by surface, but candidate identity and authority may not.
Any identity/freshness mismatch blocks candidate Telegram transport and Kite execution.

## 9. Race and duplicate protection
Immediately before Telegram send and before order build/submit:
- verify snapshotId
- verify decisionId
- verify candidateKey
- verify freshness
- verify canonical gate still passes

Idempotency: one decisionId cannot generate duplicate candidate Telegram alerts or duplicate order intents.

## 10. Execution truth
Decision reference premium is not the same as actual broker fill.
Store separately:
- decision/reference price
- submitted order details
- broker acknowledgement/rejection
- actual fill price
- slippage
- realized/unrealized P&L
All execution receipts return to the same decisionId.

## 11. Dashboard freeze
Main tabs:
1. LIVE MARKET
2. OPTIONPILOT EDGE™
3. INTELLIGENT JOURNAL
4. EVIDENCE MEMORY
5. PERFORMANCE
6. EXECUTION

Neon/marketing visuals are presentation only and never feed calculations.
Live visual tape may refresh sub-second/near-live; analytical horizons remain 1m/3m/6m/15m/30m.

## 12. Intelligent journal
Automatic event/minute records include:
- what changed since prior state
- Buyer behaviour
- Seller behaviour
- premium behaviour
- heavyweight/sector/market breadth context
- candidate considered
- pass/reject/no-trade reason
- Telegram status
- Kite order/fill/reject status
- later outcome annotation

Market-psychology labels (absorption, exhaustion, acceptance, rejection, chasing, short-covering, participation expansion/narrowing, etc.) require measurable evidence; AI may not invent them.

## 13. Historical/evidence memory
Closed 1-minute states become same-day historical evidence immediately.
Comparison hierarchy may use:
- immediate 1m/3m/6m/15m/30m memory
- today-so-far regime
- recent days
- similar historical state fingerprints

Historical similarity provides context/confidence only and cannot override current hard-selector authority.

## 14. AI boundary
AI may summarize, explain, journal and compare verified deterministic outputs.
AI may not:
- invent market facts
- certify raw-data quality on its own
- change CE/PE/strike/expiry/DTE
- override candidate selector or risk gate
- authorize Telegram transport or Kite execution

## 15. Quantum boundary
Quantum/QUBO is SHADOW_RESEARCH_ONLY until separately validated.
It may rank only already-eligible deterministic candidates and may compare:
- DTE/strike alternatives
- premium response
- liquidity/spread
- theta/IV burden
- 3m/6m/15m/30m stability
- candidate churn
- NIFTY/SENSEX exclusivity
Its divergence from the classical selector is recorded. It has no live Telegram/execution authority.

## 16. Build order — frozen chain
A. One-roof snapshot envelope
B. Existing live-source adapters into the envelope, with heavyweight/sector verification
C. Deterministic live business-evidence producer
D. Exact hard-selector + canonical buyer packet
E. Final locked trade-packet/idempotency boundary
F. Dashboard/Telegram/Kite consumers from the same packet
G. Intelligent journal + immutable minute evidence
H. Evidence-memory comparisons
I. Shadow quantum optimizer
J. Shadow execution/P&L verification
K. Only after all gates pass: separate explicit decision on real-money enablement/deployment

## 17. Devil-check gates for every PR
Every implementation PR must answer:
- Did this create a second candidate authority? If yes: reject.
- Can stale data reach Telegram/Kite? If yes: reject.
- Can UI/AI/quantum alter the locked candidate? If yes: reject.
- Can recorder failure erase market truth or silently change decisions? If yes: reject.
- Can Dashboard/Telegram/Kite disagree on candidate identity? If yes: reject.
- Are unverified heavyweight/sector facts being fabricated? If yes: reject.
- Are research-only outputs promoted into live authority? If yes: reject.
- Is any Railway deployment/execution authority added without explicit user approval? If yes: reject.

Branding: OPTIONPILOT PRO™ / OPTIONPILOT EDGE™ — Exclusively Designed by Bhagirathi Sir.
