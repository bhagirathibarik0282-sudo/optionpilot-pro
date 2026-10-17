# Chapter live values — 2026-10-17

Status: PARTIAL. Source projection and regression checks pass; open-market runtime
and desktop/mobile visual proof for this change are NOT_PROVEN. This is not a
claim that every chapter, graph or parameter is tick-live.

The existing `optionpilot:live-context` event now feeds chapter-specific numeric
cards beside the existing recorded chapters. No new requests, socket, provider,
database, execution, selector or Telegram path is introduced. The live shell
stays visible on mobile and moves immediately below chapter navigation. A button
opens the existing live expiry/strike/chart controls. The live selection is
independent of recorded settings and each contract card identifies its source.

| Chapter | Live numeric context | Retained historical scope |
| --- | --- | --- |
| 01 Overview | Spot, futures, CE/PE, PCR, VIX for all three indices | Recorded overview |
| 02 Spot + pivots | Spot, previous-close reference/change, futures, basis | Recorded levels and charts |
| 03 Premium comparison | Selected exact CE/PE price and OI, PCR, VIX | Recorded independent-contract comparison |
| 04 Four expiries | Selected live pair, explicitly labelled | Four-expiry charts remain recorded; existing Premium behaviour supports live multi-expiry |
| 05 Futures | Price, OI, volume, synchronized basis, spot, PCR | Recorded futures history |
| 06 OI + walls | Exact-pair OI, qualified full PCR and same-source walls | Recorded changes/migrations |
| 07 Notable changes | Current CE/PE, PCR, VIX | Recorded event times and responses |
| 08 Premium behaviour | Existing independent LIVE/RECORDED workspace retained | Own recorded mode; no unrelated live-pair cards |
| 09 Sectors + stocks | Fresh shared-universe breadth, per-quote changes/times | Existing independent quote snapshots |
| 10 Spot + full PCR | Three-index live spot and cadence PCR cards | Existing recorded charts |
| 11 FII / DII | Separate live market context only | Dated stored EOD cash remains EOD |
| 12 India VIX | VIX and selected index spot/CE/PE | Recorded single VIX series |
| 13 Combined context | Current spot/futures/basis/CE/PE/PCR/VIX | Existing recorded agreement; no new score |

## Devil check

- Only connected Kite FULL snapshots for the server trading date are accepted.
  Snapshot time must be no more than four seconds old relative to server time.
- Individual quotes must have matching role/index/option side/expiry/strike,
  same-session exchange and receipt times, and the existing 30-second freshness
  limits. Rejected quote values say WITHHELD; real zero OI remains zero.
- Basis requires fresh spot/futures and maximum five-second source skew.
- PCR and walls use the same complete source. Published cadence samples take
  precedence; missing/failed cadence samples cannot fall back to tick PCR or a
  recorded value. Counts, expiry and source timestamps must qualify.
- Stock/sector breadth explicitly says shared, unweighted universe; it is not
  represented as selected-index weighting. Missing quotes stay in denominators.
- Disconnect/null events clear numeric live cards without altering recorded
  models or making requests. Existing stream heartbeat/visibility guards remain.
- Open per-source details survive incoming live updates. Live values and
  recorded charts retain separate source labels and selection scope.

Validation: exact Business Dashboard V1 workflow command — 189/189 PASS,
including seven chapter-live tests and serialized browser-script parsing.
Permanent guardrail check PASS. Open-market tick movement and actual desktop/
mobile appearance require runtime verification after an approved merge; the
market is closed on this Saturday. No production mutation in this step.
