# Production market book

The book is the first surface at `/api/research/business-dashboard/view`. It uses the existing browser session, CORE replay API, saved prior-session recordings, stock/sector quote snapshots and FII/DII readiness route. No added routes, tables, services, candidate votes, execution or Telegram operations.

Thirteen chapters share 3/5/15/30/60-minute or 1/3/5/9-prior-session comparisons. Dates, strike, and CE/PE expiries are selectable. The existing single-flight 60-second refresh and three-minute recording cadence remain the update limit. Chapters refresh from shared state, with page-turn animation respecting reduced-motion preferences.

## Exact comparisons

Only TRUE market/option/chain rows enter the book. Intraday differences require a point exactly the selected number of minutes earlier. There is no nearest-point substitution. Multi-session comparison requires the exact selected recorded date and exact option identity. Swing charts show daily endpoint dots, with no overnight connecting lines. Futures swing differences are withheld because the replay source does not expose contract expiry identity.

Green requires positive spot and CE changes plus a negative PE change at identical current and baseline timestamps, in the same expiry and strike. Red requires the reverse. Mixed or unavailable agreement stays neutral. These are descriptive changes, not orders or calibrated probabilities. Existing agreement stars are shown only for matching exact endpoints. OI adding by itself receives no directional colour.

PDH is bright cyan and PDL bright pink. R3–S3 Fibonacci pivot values are labelled inside charts: P=(H+L+C)/3; offsets are 0.382, 0.618 and 1.0 times the range. Prior H/L and the exact 15:30 sampled endpoint must exist; the endpoint is not represented as an official exchange close. Intrinsic/extrinsic values require the exact same-time recorded underlying. Negative extrinsic values are withheld; implied volatility is labelled separately.

## Source limitations

- Five-minute changes are normally unavailable with a three-minute recorder.
- First 15-minute high/low is explicitly a sampled LTP range, requiring 09:15 and at least five samples through 09:27. It is not the exchange candle's tick-exact high/low. Crossings need adjacent points no more than three minutes apart.
- Official option session Open is absent: O=H is unavailable, never inferred from the first sample.
- Contract-specific futures PDH/PDL and previous H/L/close are absent: those levels are unavailable.
- Up to four actually returned option expiries appear. A missing fourth NIFTY/SENSEX expiry stays missing. BANKNIFTY is monthly/longer-dated observation. Relative source buckets such as Current/Next/Monthly must not be mistaken for contract frequency or used to discard current monthly contracts.
- Full PCR needs the existing resolved provenance. Band PCR never replaces it.
- Stocks/sectors are independent quote snapshots versus previous close, with response timestamps and no exposed exchange freshness or selected-window historical baseline. Individual PSU-bank stock coverage is absent in the existing stock endpoint. Smallcap 100, Midcap 100 and PSU Bank sector quotes use the existing sector endpoint.
- FII/DII is dated end-of-day context, not intraday flow. Its independently verified session may differ from the selected replay date.
- No faster quote feed or new historical source has been introduced.

## Validation

`NODE_ENV=test node --import tsx --test test/market-book.test.ts test/business-dashboard-v1.test.ts test/data-three-modes.test.ts test/data-reading-checklist.test.ts test/dashboard-refresh-mobile.test.ts test/dashboard-data-annex.test.ts`

This checks identity, provenance, exact/missing interval behaviour, direction colours, prior-session pivots, sampled opening range coverage, futures rollover exclusions, and serialized browser chapter rendering. Existing production proof checks still verify read-only authority.
