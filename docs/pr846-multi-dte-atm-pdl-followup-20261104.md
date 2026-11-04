# All-expiry ATM premium PDL: what happened next?

Status: PARTIAL. Analysis covers only previously retrieved 4 Nov 2026 11:45–12:45 IST CORE windows for three indices, not all recorded days. Stored PDL provenance has not been independently reconstructed from the prior trading session.

## Trigger definitions
- Freeze each expiry's chain-reported ATM strike at event time. Follow that exact strike afterwards, even if ATM moves.
- CE and PE are independent studies, each using its own stored premium PDL.
- Require source-admitted adjacent-minute quotes, exact snapshot/market receipt, quote age -5 to +30 seconds, stable positive PDL and the same contract on both sides of a crossing.
- ALL_CROSS_SAME_MINUTE: all available archive expiries move from >= own PDL to < own PDL in the same minute.
- LAST_EXPIRY_JOINS_ALL_BELOW: all are below now and at least one newly crossed this minute; distinguish from simultaneous crossing.
- ALREADY_BELOW_AT_WINDOW_START: below at the start of retrieved data, with no observed crossing time. Do not label as a new break.
- Missing a required expiry, quote, ATM identity or PDL means the all-expiry trigger is unverified. Observed individual-expiry crosses remain separate. Scope is available archive expiries, not an independently verified exchange expiry universe.

## Observed NIFTY state and follow-up
At 11:45 IST, all three available expiries' ATM was 23800, and all three 23800 PE quotes were below their stored premium PDL. The break timestamp is not present in this window.

| Expiry | Stored PDL | 11:45 PE | +3m PE | +5m PE | +15m PE | PE change at +15m | Same-strike CE change at +15m |
|---|---:|---:|---:|---:|---:|---:|---:|
| 9 Nov | 290.00 | 199.10 | 199.65 | 207.85 | 209.25 | +10.15 | -16.15 |
| 17 Nov | 345.55 | 268.10 | 272.55 | 276.00 | 278.30 | +10.20 | -14.90 |
| 23 Nov | 376.45 | 306.50 | 306.50 | 313.35 | 315.50 | +9.00 | -15.10 |

All displayed endpoint quotes pass the existing scanner freshness rule. PE rebounded by 12:00 while remaining below PDL at that endpoint; opposite CE fell. These selected horizons are exact endpoint checks, not proof of uninterrupted below-PDL continuity or absence of an interim reclaim.

## Event-search coverage
- NIFTY CE: 52 eligible adjacent minutes, 9 unverified; no new all-expiry crossing found.
- NIFTY PE: 54 eligible adjacent minutes, all 54 already-below states; 7 unverified; no new all-expiry crossing found.
- SENSEX and BANKNIFTY: 0 eligible all-expiry adjacent-minute observations, 61 unverified each side; no all-expiry conclusion possible.
- Two individual BANKNIFTY 23 Nov 55500 PE crossings were observed at 11:59 and 12:18 IST. They do not establish all-expiry events.

## Required dashboard outcome structure
Event time and category; expiry/strike/PDL/entry observation; exact +3/+5/+15/+30 endpoint change and percentage; first observed reclaim with continuity coverage; sampled favorable/adverse excursion; exact opposite premium response; same-window spot/futures/PCR/OI/VIX context. Always show source coverage and freeze contract identity. Missing follow-up is unavailable, not failure. Outcome labels must distinguish further fall, bounce below PDL and actual PDL reclaim. Event-level statistical validation over nonoverlapping days remains pending. No automated trade or directional guarantee follows from this state.

## Sources and audit
Existing recorded-dashboard dates and replay GET routes. Response hashes and request metadata are in pr846-current-week-readback-20261104.json. Machine-readable coverage/events are in pr846-multi-dte-atm-pdl-audit-20261104.json; selected endpoint quotes and receipts are in pr846-multi-dte-atm-pdl-followup-20261104.json. Original remote responses were expanded by matching compact table columns with row values. No interpolation or ATM substitution was used.
