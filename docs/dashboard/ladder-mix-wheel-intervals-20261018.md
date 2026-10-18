# Complete ladder scope and participation intervals

Status: PARTIAL — local verification only; production acceptance pending.

## Ladder

- CE price / strike / PE price remain three columns. Selected parameters stack
  below their own price; additive switches persist independently. PDH is green,
  PDL red, PDC gold. Observed PDH/PDL reaction is shown separately.
- OI, OI change, price change, volume, available Greeks/IV, Bid, Ask, Spread,
  prior-session references and existing Daily FIB can be mixed. Missing fields
  remain unavailable, including Greeks/IV absent from Kite FULL packets.
- ATM ±7 explicitly means 15 strikes. Existing 3/5/7-strike options remain.
- Ladder uses a complete selected projection of the existing bounded token
  cache in one request (`view=ladder`); ordinary cards retain their limits.
  It does not create broker requests or subscriptions. Selected recorded rows
  are not paginated. Next/previous page controls are hidden in Ladder.
- Client rejects an incomplete live ladder response; contract histories retain
  at most 30,000 sampled points overall, up to 130 per selected contract.
  Contract-specific quote freshness and stalled delivery checks remain active.

## Wheel

- Feed unavailability no longer hides index, view or wheel selection controls.
  Recorded mode still hides its live workspace. Missing live numbers stay missing.
- Heavyweights and Sectors display named components, current price, selected
  interval percentage and actual source/baseline times. Breadth rings include
  up/down/unchanged/unavailable percentages; they remain unweighted counts.
- Day uses the existing previous-close change. 1/3/6/15/30m use same-token,
  same-role, same-label, same-session prices with an earlier endpoint within
  five seconds of the requested interval. Missing baselines show Building
  history, never a substituted day percentage or invented movement.
- History comes from the existing live-context stream. It is browser-local,
  bounded to 31 minutes/450 samples per identity/512 identities, and resets on
  disconnect, runtime or session change. Refresh needs to rebuild intervals.
- Recorded option-OI wheels also show CE and PE percentages.

## Validation

- Full Business Dashboard CI command locally: 287 tests passed, 0 failed.
- Added coverage: >120-contract complete cache projection, ATM ±7 selection,
  additive metrics, all 15 paired rows without pages, all five participation
  intervals, wrong-token/label/session/baseline withholding, runtime resets,
  delayed delivery, offline controls and unchanged ordinary-card pagination.
- Guardrail check and git diff --check pass. Production scripts serialize and
  execute in the existing dashboard harness.
- Local browser preview was BLOCKED because this browser could not reach the
  local preview server. Visual mobile acceptance is NOT_PROVEN by these tests.
- Live-market runtime proof remains NOT_PROVEN while the market is closed.
  No candidate, Telegram, execution, database, merge or deployment changes.
