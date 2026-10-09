# Production market book

The book is the first surface at `/api/research/business-dashboard/view`. It uses the CORE replay API, saved prior-session recordings, server-recorded stock/sector quotes and FII/DII readiness route. The background quote read route is described below; candidate votes, execution and Telegram operations are unchanged.

Thirteen chapters share 3/5/15/30/60-minute or 1/3/5/9-prior-session comparisons. Dates, strike, and CE/PE expiries are selectable. The existing single-flight 60-second refresh and three-minute recording cadence remain the update limit. Chapters refresh from shared state, with page-turn animation respecting reduced-motion preferences.

## Exact comparisons

Only TRUE market/option/chain rows enter the book. Intraday differences require a point exactly the selected number of minutes earlier. There is no nearest-point substitution. Multi-session comparison requires the exact selected recorded date and exact option identity. Swing charts show daily endpoint dots, with no overnight connecting lines. Futures swing differences are withheld because the replay source does not expose contract expiry identity.

Green requires positive spot and CE changes plus a negative PE change at identical current and baseline timestamps, in the same expiry and strike. Red requires the reverse. Mixed or unavailable agreement stays neutral. These are descriptive changes, not orders or calibrated probabilities. Existing agreement stars are shown only for matching exact endpoints. OI adding by itself receives no directional colour.

PDH is bright cyan and PDL bright pink. R3–S3 Fibonacci pivot values are labelled inside charts: P=(H+L+C)/3; offsets are 0.382, 0.618 and 1.0 times the range. Prior H/L and the exact 15:30 sampled endpoint must exist; the endpoint is not represented as an official exchange close. Intrinsic/extrinsic values require the exact same-time recorded underlying. Negative extrinsic values are withheld; implied volatility is labelled separately.

## Sectors and key-stock chapter

The participation chapter shows three index-specific returned key-stock subsets side by side. Each card exposes usable coverage, unweighted up/down/flat/missing counts, strongest positive and negative returned quotes, sorted percentages, prices when available, and bars around a shared zero centre within that card. All/Up/Down/Missing filters survive refresh. An absent/empty response shows Unavailable and the existing source status, with no zero counts or 0/0 breadth. Returned rows without usable percentages show unknown Up/Down/Flat counts and the actual missing-row count. A real numeric 0% remains a flat quote. The chapter exposes the existing single-flight quote refresh and app login link. Only finite numeric source values enter the counts; null, malformed and absent quotes remain missing.

Sector quotes are grouped into financials/PSU Bank, industry sectors, and broader-market Smallcap/Midcap index proxies; additional returned names stay visible. Response timestamps and a selected-replay date mismatch are explicit. These are percentages versus previous close, not selected-window changes, weighted index contribution, full-constituent breadth or verified exchange-fresh data. Intraday/swing historical stock/sector baselines remain unavailable.

## Source limitations

- Five-minute changes are normally unavailable with a three-minute recorder.
- First 15-minute high/low is explicitly a sampled LTP range, requiring 09:15 and at least five samples through 09:27. It is not the exchange candle's tick-exact high/low. Crossings need adjacent points no more than three minutes apart.
- Official option session Open is absent: O=H is unavailable, never inferred from the first sample.
- Contract-specific futures PDH/PDL and previous H/L/close are absent: those levels are unavailable.
- Up to four actually returned option expiries appear. A missing fourth NIFTY/SENSEX expiry stays missing. BANKNIFTY is monthly/longer-dated observation. Relative source buckets such as Current/Next/Monthly must not be mistaken for contract frequency or used to discard current monthly contracts.
- Full PCR needs the existing resolved provenance. Band PCR never replaces it.
- Stocks/sectors are independent quote snapshots versus previous close, with response timestamps and no exposed exchange freshness or selected-window historical baseline. Individual PSU-bank stock coverage is absent in the existing stock endpoint. Smallcap 100, Midcap 100 and PSU Bank sector quotes use the background quote read endpoint.
- FII/DII is dated end-of-day context, not intraday flow. Its independently verified session may differ from the selected replay date.
- No faster quote feed or new historical source has been introduced.

## Validation

`NODE_ENV=test node --import tsx --test test/market-book.test.ts test/business-dashboard-v1.test.ts test/data-three-modes.test.ts test/data-reading-checklist.test.ts test/dashboard-refresh-mobile.test.ts test/dashboard-data-annex.test.ts`

This checks identity, provenance, exact/missing interval behaviour, direction colours, prior-session pivots, sampled opening range coverage, futures rollover exclusions, and serialized browser chapter rendering. Existing production proof checks still verify read-only authority.

## Background quote collection

The production entrypoint starts the stock/sector collector independently of
browser tabs. It resolves the encrypted shared Kite authority on every attempt,
fetches one deduplicated quote batch every three minutes during equity market
hours, and retries failures after one minute. Calls cannot overlap. Recorded
public market observations are persisted in `app_state_log` with kind
`DASHBOARD_BACKGROUND_QUOTES_V1`; credentials are never included.

The DATA dashboard reads `/api/research/background-quotes` (with `symbol` for
key stocks). Reads never trigger a broker call or require the viewer's browser
Kite session. Missing and stale observations fail explicitly; a response older
than six minutes or from another trading date is not displayed as current.
Receipt timestamps do not prove exchange freshness. Daily Kite token expiry
still requires reconnection. Existing index/options recording stays unchanged.

## Strike comparison

CE ↔ PE exposes Strike A and optional Compare strike B beside the premium cards. Both use the same index, selected window and independently selected CE / PE expiries. Choices are the union of actual recorded strikes in those expiries. A missing side or exact baseline stays unavailable; neither another strike nor another expiry substitutes. The compact comparison table exposes price, ₹/% movement, OI change, PDH/PDL and both endpoint timestamps. Strike B charts are expandable; selection survives same-session refresh and resets on index/date changes. The nearest-strike button uses recorded spot and the available strike list, not an inferred full-chain ATM contract.

## Premium chart clarity

Premium charts default to premium + PDH/PDL. Shared buttons toggle PDH/PDL, Fibonacci pivots and the sampled opening 15m H/L; hidden levels are excluded from scale. These preferences survive refresh. Full screen opens a native modal with exact index/expiry/strike identity, source timestamps, the same toggles and an explicit Close button; Escape closes it. Same-contract refresh updates the open chart and a missing identity closes it. The index/expiry/Strike A/B strip sticks below the measured header and scrolls horizontally on small screens. Existing chart trace gaps and level colours remain unchanged.

## Unified premium comparison

The Premium comparison chapter replaces the separate CE/PE and four-expiry navigation entries. It offers CE ↔ PE with independent expiries, Strike A/B with one shared expiry, and same-strike expiry comparison across the first four actual recorded dates or selected A/B. Internal chapter indices remain stable for existing links.

Separate CE and PE tables expose exact identities, DTE, premium, recorded-window ₹/% movement, OI movement, premium-minus-PDH/PDL distances and endpoint timestamps. Missing or zero levels remain unavailable. Largest recorded percentage changes are described only when every compared side has matching exact endpoint/baseline timestamps and positive baselines; ties remain explicit.

Optional movement charts compare selected A/B on one ₹ or baseline-% scale. They require two different exact contracts and synchronized endpoints. Missing points and gaps over three minutes remain disconnected. Individual level charts remain optional and retain layer controls and full-screen access. This is a client-side view of existing recorded state, with no additional fetches, timers, recording authority, or order behavior.

Validation: 66 dashboard/model/serialized-browser tests pass, including identity isolation, absent baselines/sides, invalid levels, normalized baselines, mismatched timestamps and tied expiry changes.

## Structured spot and full PCR

The Spot + full PCR chapter starts with a compact three-index table, then shows detail for the pinned Index and CE expiry selection. Spot and full PCR expose independent values, selected-window deltas, baselines and recording timestamps; paired movement is described only when the existing exact endpoint checks pass. Other index rows retain their own recorded expiry. PE expiry and strike do not scope full-chain PCR.

The optional stacked chart retains a shared time axis and separate units. Choose one spot layer: price only, PDH/PDL (default), or first-15-minute sampled high/low. Hidden levels do not enter the scale. Spot-minus-level distances remain visible in a separate table; invalid/zero/missing levels remain unavailable. Previous-session/source details, exact intraday intervals and the latest six paired records are expandable and preserve open state across render. Intraday interval tables are explicitly labelled separately from swing comparisons.

Validation: 67 dashboard/model/serialized-browser tests pass. Coverage checks selected-index isolation, layer persistence, removal of hidden chart levels, missing source data and mismatched timestamps. Existing calculations, refresh and background recording are reused unchanged.
