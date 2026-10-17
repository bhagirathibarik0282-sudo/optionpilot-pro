# Chapter 6 live OI + Walls implementation

Implements the approved OI/Wall Studio rather than another static demo.

## Delivered code

- Three-index Full/Band PCR strip retained. Direct index/actual-expiry controls,
  independent CE/PE premium strike controls and 1/3/6/15/30-minute lookbacks.
- Live OI pulse per exact contract: green adding / red shedding / unchanged,
  source time and finite 1.8-second blink; duplicate packets/view changes do not
  restart the animation. Reduced motion disables it.
- Ladder and columns show up to seven listed nearby strikes. Wheel shows full
  selected-expiry totals. Max Pain uses the complete qualified chain and an O(n)
  intrinsic payout sweep with tied minima; gap is signed distance to its range.
- Evidence shows side totals, PCR drivers, wall migration and Max Pain context.
- After event consumes existing recorded exact-expiry event responses, extended
  with exact 1/6-minute targets without moving the existing response indices.
  Missing endpoints remain missing; no interpolated response or synthetic P&L.
- Candidate reads the existing Business Dashboard endpoint only on user request;
  validates canonical identity locks; expires its display after 30 seconds.
  BANKNIFTY remains monthly observation only. No candidate authority changes.
- Previous recorded OI chapter retained in a closed archive; no duplicate open
  wall-card stack. A recorded-scope control opens the existing session loader.

## Data and operational boundaries

Uses the existing sampler request batch and token cache, not another socket or
provider request. Independent studio premiums do not change legacy CE/PE quote
identity. Additional per-side stream query parameters validate at the HTTP
boundary. Complete chain rows are sent once per OI cycle per viewer; subsequent
price frames retain them through a matching runtime/expiry/cycle cache. Shared
sampler state is never modified by stream compaction.

Window calculations use up to 36 qualified browser snapshots per context,
35-minute retention and at most 12 contexts. Last-change pulses cap at 256 tokens.
Lookbacks need exact cycle baselines within one second and identical contract
inventory. Startup/reconnection may require history warm-up; this is explicit.
No new database, provider polling timer, execution, Telegram or trading observer.

Kite REST last prices require a fresh last-trade timestamp separately from quote
OI time. Tick premiums use independently validated exact FULL quotes. OI snapshot
and latest tick times are labelled separately. Missing/stale/partial chains,
identity mismatches, mutated cycles and backwards clocks withhold values.

## Validation

- New component tests: full-chain math against brute-force payouts; scope and
  failure cases; all controls; exact lookbacks; finite pulse / duplicate behavior;
  recorded event provenance; canonical candidate source; HTTP side identities;
  actual serialized script parsing; mutated cycles and reversed clocks.
- Existing dashboard regression suite plus the new component tests.
- Full npm test and permanent guardrail check.
- Production success and browser checks are recorded after deployment; source
  tests alone do not establish live broker operation while the market is closed.
