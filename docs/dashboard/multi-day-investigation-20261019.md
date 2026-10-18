# Readable multi-day market investigation

The Recorded Premium behaviour workspace now contains a collapsed “Multi-day investigation · what changed?” section. Reuses the existing authenticated H1 replay loader, canonical PCR repair, archived option fields and Same Delta matcher. No broker requests, new database, candidate authority or execution changes.

## Six user-facing parts

1. Date range and three modes: Events, Market Move (same user-selected clock interval for each date), and Find Similar (same observed event types/directions within the loaded range). Read at most 20 recorded sessions sequentially; failed/empty dates and cancellation are explicit. The dashboard session is not changed.
2. Fixed exact-expiry/CE/PE contracts, Match Delta at Start (default; lock those contracts around each event), and Follow Delta (mark re-selection and withhold cross-contract returns). Custom Delta supports (0,1]. Exact expiry and calendar DTE filters are optional except in Fixed mode.
3. Compact controls, an event selector, normalized Spot/CE/PE checkpoint plot and seven-row key table. All-event lists, other changes, extra parameters and source timelines are collapsed. Mobile uses two control columns and contained horizontal table scrolling.
4. CE/PE wall strike shifts, Max Pain shifts, wall+Max Pain together, and Spot/selected-premium PDH/PDL crossings. Events use exact adjacent archive cadence (3m before 2026-10-19, 1m afterward), same expiry and unchanged crossing levels. Duplicate or unverified rows cannot bridge an event. Wall OI always belongs to the strike at that timestamp; no OI transfer or causal authority is inferred.
5. Exact checkpoints −30/−15/−6/−3, event, +1/+3/+6/+15/+30 and the selected response window. Show Spot, Futures/OI/basis, VIX, provenanced full PCR, walls/OI, Max Pain, CE/PE premiums/OI/IV/Delta, contract identities and quote times. Missing endpoints stay missing. Heavyweight/sector interval history and futures expiry continuity are not supplied by this replay projection and are disclosed rather than invented. Ask RAG forwards the selected exact CE to the existing evidence card.
6. Multi-date event list, complete-pair counts, independent per-metric sample counts and medians, plus sampled fixed-contract min/max reaction. Similarity uses event types and before/current change directions, not later returns. Market Move outcomes and all forward measurements are retrospective. This is event measurement, not a new entry/exit backtest or win-rate claim.

## Data and validation

Archive quotes require the exact market snapshot ID, TRUE verdict, finite positive premium, archived quote age <=60s, valid source timestamp and actual backend receipt. A floor-minute bucket is not treated as the receipt timestamp. No interpolation or next-minute substitution. Follow Delta never reports mixed-contract returns.

307 dashboard regression tests passed before final wording refinements, including 11 new investigation tests. Guardrails and diff check pass. Tests cover actual serialized UI, sequential reads/cancel/errors, old/new cadence, source-time checks, identity changes, duplicate rejection, level events, missing endpoints and no mutation of inputs.

Three production archive samples (NIFTY, 2026-10-13/15/16, 09:30–10:00, FULL) were read through the existing API and processed locally. Wall/Max Pain events and some qualified Delta pairs were observed; incomplete last-window outcomes remain unavailable. These samples are not a complete date-range or Greek-accuracy certification. Deployment and browser proof are recorded separately after CI passes.
