# Chapter 6 — OI + Walls: approved design and architecture

Design decision: user approved the Relationship Research sample on 18 October
2026 IST. This document freezes the intended chapter, not its deployment status.
Reference preview: `/workspace/oi-research-sample.html` (synthetic demo only).

## Layout contract

Use the approved compact appearance and ordering:

1. Three-index Full / Band OI PCR ladder and separate alignment badges.
2. Explicit index and actual-expiry selectors; comparison windows 1/3/6/15/30m.
3. CE / PE top walls with same-strike OI change and wall migration; spot, ATM,
   Max Pain level or tied range.
4. Relationship Research with Evidence / After event / Candidate buttons.
5. Premium watch with independent CE and PE strike selectors.
6. Ladder / Columns / Wheel buttons, sharing one qualified selected context.
7. Closed relationship/source and wall-migration drawers.

Keep the default compact; expose explanations and source detail on demand.
Index/expiry selection must update every dependent view and invalidate pending
results for the previous context. BANKNIFTY is monthly observation only.
Keep a stable contract identity while tracking a premium; do not silently roll
to the new ATM. Label full, 15-strike band, and displayed 7-strike scope explicitly.

## State and data flow

Existing Kite quote/cache + existing full-expiry OI sampler
→ validated, immutable context snapshot
→ descriptive metrics and same-contract history comparisons
→ Chapter 6 renderer.

Existing recorded evidence store
→ event study using historical point-in-time availability
→ research results and provenance drawer.

Existing canonical candidate selector
→ existing Business Card candidate/status
→ read-only Candidate tab reference.

No synthetic fallback in production, new broker connection, new database,
duplicate selection authority, or orders. Reuse existing cadences and caches;
comparison windows are not provider polling intervals. The chart view selector
does not trigger provider calls.

Existing `dashboard-pcr-sampler.ts` supplies qualified Full PCR, walls, totals,
coverage and source times. The compact-PCR work adds qualified Band PCR.
`dashboard-live-feed.ts` / `dashboard-live-runtime.ts` provide existing live
state. Extend their shared `optionpilot:live-context` delivery rather than
introducing a parallel feed. Strike-level snapshot exposure/history, Max Pain,
and the broader chapter renderer remain implementation work; their availability
must not be inferred from the demo.

## Update semantics

- Last-update delta: compare new and preceding accepted OI for the exact same
  index / expiry / strike / side. Show the actual baseline and source time.
- Window delta: compare to the qualified observation at the selected lookback;
  display actual endpoints and reject comparisons outside established tolerance.
- Positive = green ADDING; negative = red SHEDDING; equal valid OI = neutral
  UNCHANGED. Missing/stale is WAIT / STALE, never neutral or zero.
- Blink only the affected last-update marker for 1.8 seconds on a newly accepted
  OI change. Duplicate packets, switching views/windows and unchanged OI must
  not retrigger blinking. Respect reduced motion.
- A premium-only update cannot trigger an OI pulse. A source timestamp is not a
  separate timestamp for every field; retain received time and provenance.
- Reset baselines on session/contract changes. Band comparison resets when its
  strike membership changes. Retain real zero PE OI; reject zero CE denominator.

## Relationship definitions

All calculations use one expiry, explicit strike scope and qualified endpoints.

- Full PCR = total PE OI / total CE OI. Attribute change to both side totals.
- Top wall = highest OI strike per side; retain tied strikes and runner-up OI.
  Distinguish same-strike OI change from a change in the top-ranked strike.
- Max Pain = settlement level minimizing full-chain aggregate intrinsic payout;
  retain a tied minimum range. Incomplete/stale full coverage withholds it.
- Spot–Max Pain gap = spot minus Max Pain; display both component changes.
  For tied Max Pain show distance to the range; any midpoint must be labelled
  explicitly and must not replace the range in event classification.
- PCR, walls and Max Pain share underlying OI. Do not add their directions as
  independent confirmation votes or assume that Max Pain attracts spot.
- Premium reaction is measured for a fixed contract. IV/Greeks attribution is
  shown only when validated inputs exist; Kite FULL packets alone do not supply
  IV/Greeks. No inferred buyer/seller identity from aggregate OI.

## Research and candidate contract

Evidence tab: observable changes with exact identities, scopes and endpoints.
After event tab: retrospective outcomes separated from information available at
the anchor time. Examine before-30m and after-1/3/6/15/30m, bounded by the session.
Candidate tab: reuse canonical selector status and identity. Descriptive events
cannot create a candidate. Missing calibration shows unvalidated, not a score.

Test incremental value against spot / IV / DTE / time-of-day context, adding OI,
walls, PCR, Max Pain and other indices separately. Preserve independent event/day
counts, costs, bid/ask availability, adverse/favorable excursions, uncertainty
and chronological out-of-sample results. Overlapping windows are not independent
trials. Do not require three-index agreement without testing its incremental
value. Never fabricate a win rate, sample count, net edge or confidence score.

## Acceptance and delivery boundaries

- Three index choices, actual expiry and both strike choices refresh every
  dependent field without stale-context mixing.
- Same-strike changes, duplicate packet behavior, source freshness and band
  re-anchoring are verified; finite blinking stops and reduced motion works.
- Exact Full/Band scopes, tied walls/Max Pain, missing quotes and real zero OI
  are handled explicitly.
- Live and retrospective research stay separate; canonical candidate authority
  remains unchanged.
- Verify the real chapter at mobile widths and desktop before claiming visual
  parity. Confirm production data provenance before claiming live readiness.
- Deliver tested implementation for review. This design approval is not a
  merge/deployment approval.

Current status: design approved and production implementation prepared in
`oi-wall-studio.ts`; see `chapter-6-live-wall-studio-release.md`. Historical
research calibration and market-open broker proof remain separate from UI delivery.
