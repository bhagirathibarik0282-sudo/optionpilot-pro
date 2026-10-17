# Live three-index Full PCR strip — 18 October 2026

Status: locally tested; production and open-market numeric evidence NOT_PROVEN.

Adds compact NIFTY, SENSEX and BANKNIFTY Full PCR values with finite blinking
change arrows and a descriptive alignment badge above existing live fields in
OI + walls and Spot + full PCR. Duplicate PCR fields in those chapter projections
are hidden; the source feed and other chapters retain their existing behavior.
Each index keeps its own selected live expiry, source time and 1/3-minute cadence.
BANKNIFTY remains monthly observation. Source details start closed.

This change connects production presentation to the EXISTING live-context event
and complete-expiry REST sampler. It is not a deployment of the earlier simulated
Wall Studio design, nor a conversion of recorded chapter charts to live charts.
No demo values or seven-strike approximations enter the production strip.

Qualification:
- Connected Kite source, current runtime/session, fresh server snapshot, and one
  unambiguous selected index row.
- Only pcrDisplay snapshots from KITE_REST_FULL_EXPIRY_SNAPSHOT; no tick, history,
  band-PCR or last-known numeric fallback.
- Full subscribed-expiry inventory coverage, positive CE OI, nonnegative PE OI,
  finite ratio agreeing with the totals, and explicit timezone source timestamps.
- Exact selected expiry, complete fresh OI count, permitted cadence and source skew.
- Existing full-expiry sampler/instrument-master coverage is reused; no new claim
  that a seven-strike band represents full-chain coverage is introduced.

Arrows compare two consecutive qualified snapshots for the same runtime, session,
index, expiry, cadence and expected contract count. Gaps, incomplete cycles,
changed expiry/cadence/runtime/inventory, disconnects or invalid data reset the
baseline. Duplicate samples do not restart a blink; modified or older samples
cannot create an arrow. Up/down arrows blink for 1.8 seconds only; flat does not
blink. Reduced-motion preference disables animation.

All-up/all-down/all-flat/mixed labels describe PCR changes only. Both baseline
and current cycle IDs and display cadences must match across all three indices;
combined source-time skew must be <=30 seconds at BOTH endpoints. Otherwise the
badge stays WAIT or TIME MISMATCH. Independent valid numbers may still display.
There is no buyer/seller, bullish/bearish, probability or candidate authority.

PCR is a periodic OI snapshot, not tick-by-tick PCR. Price ticks cannot fabricate
an OI change. Existing transport/watchdog invalidation is reused; no new request,
stream, timer, provider, persistence or configuration is added by this strip.

Devil Check / validation:
- 11 focused tests: all direction states; coverage, totals, stale/identity/source
  rejection; zero preservation; invalidation and baseline resets; synchronized
  three-index windows; finite blink; 1/3-minute cadence; real serialized event,
  navigation, disconnect, no new requests and unchanged recorded source state.
- Exact Business Dashboard V1 workflow: 221/221 PASS.
- Full npm test: PASS; generated server/Telegram wiring artifacts restored.
- All five generated browser scripts parse.
- Permanent guardrails and git diff --check PASS.
- Actual browser/mobile visual proof and open-market broker readback NOT_PROVEN.

No candidate, Telegram, order, seller-execution, broker configuration, database,
manual deployment or merge is included. Live proof needs release and a qualified
open-session feed; invalid or missing data is shown as unavailable, never demo.
