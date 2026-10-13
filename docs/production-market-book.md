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

## Three-index overlay, sampled turns and full chart

The primary Spot/PCR layout now shows all three indices together in a horizontally scrollable comparison row. Actual Spot/PCR values and selected-window changes remain visible above each chart. Choose percentage overlay (default) or actual-unit stacked charts; normalized charts share an exact baseline, endpoint, time axis and percentage scale across eligible indices. Missing/mismatched/zero baselines exclude that index's overlay. Percentage intersections are movement crossovers, never raw price/ratio crossovers. Recorded-session range (intraday default) and selected-window range reuse the same baseline; changing range does not change reported window deltas.

Latest SH/SL markers for Spot and full PCR require a strict local reversal across three adjacent valid recorded samples. Intraday adjacency requires exact three-minute intervals within one session. Daily views require adjacent known recorded-session endpoints. Missing samples, plateaus, gaps and final endpoints cannot fabricate a turn. Values, turn time and later confirmation time are expandable per index. Marker visibility is shared between comparison and full chart.

The full-chart dialog retains all three indices and updates from existing state. Its mode/range controls reuse the same calculations. ★ means matching exact endpoints with nonzero Spot/PCR changes in the same direction; ☆ means opposite direction or a flat series; unverified pairs remain unavailable. This is a descriptive alignment mark, with no strength/probability/trade authority.

Validation: 70 dashboard/model/serialized-browser tests pass, including three-index overlay exclusion, chart/dialog controls, sample-turn confirmation, gaps, missing daily sessions and identity-specific raw chart markers.

## Simple premium behaviour card

The Premium behaviour chapter begins with a compact card for the selected index and locked strike across every actually recorded expiry. Each expiry shows CE and PE premium, selected-window rupee/percentage change, DTE, its own PDH/PDL position, existing level-behaviour description and baseline/current recording timestamps. The month board and all-strike history remain expandable. The same card is available in the expiry-comparison view.

Paired descriptions (CE rising / PE falling, reverse, both rising/falling, flat/mixed) require positive same-contract baselines, identical baseline/current timestamps and a current recording matching the index context. Missing sides, stale recordings or absent exact baselines withhold paired descriptions. Level colour requires positive ordered own-contract PDH/PDL and the current context timestamp. This card reuses the existing shared refresh; it adds no calls, timers, storage, candidate or order authority. Recording-time alignment is not proof of exchange quote freshness.

Validation: 59 market-book, strike-comparison and dashboard tests pass, including serialized production rendering, selected-index isolation, missing sides/baselines and invalid levels.

New PDH-up / PDL-down breaks flash only for the latest exact adjacent three-minute same-contract crossing. Positive unchanged ordered references, positive prices and a current context-matching timestamp are mandatory. Every badge retains expiry, strike, side, level, prices and interval timestamps. A subsequent outside-level sample becomes static.

Gold pulsing alignment groups list at least two expiries with the same opposite CE/PE movement and identical exact current/baseline endpoints. Conflicting, stale, missing or flat peers cannot join; separate opposite groups remain distinct. Both animations honor reduced motion. No probability, trade or exchange-freshness authority is implied.

Updated validation: 62 focused tests pass, including break reset, gaps, changed levels, stale sides and four-expiry group coverage.

The compact card now retains the latest three timestamped own-level transitions per side: PDH break/loss, PDL break/recovery and PDH rejection confirmed by two lower adjacent samples. It exposes the latest event time directly and the recorded interval, prices and level in expandable history. Gaps, missing/nonpositive prices and changed/invalid references cannot establish transitions. Historical events remain visible after price moves away; only a new latest-interval break flashes.

The card labels its selected recording session. Existing dashboard startup selects today's IST date after market open and reads the existing CORE archive, including completed-session records after close; it does not substitute an older date if today's data is absent. Before release, the 2026-10-13 date index showed 127 markers for each of the three indices, ending at 15:30 IST. A NIFTY 15:24–15:30 CORE read returned 270 option rows and three actual recorded expiries (13, 19 and 27 October). This inventory is not all exchange expiries; an absent fourth expiry remains absent.

Validation: 73 focused model/UI/refresh/replay tests pass, including timeline history, event confirmation intervals, missing data and serialization.

## Independent strike selectors and three-index break agreement

Premium behaviour has visible local Index, CE strike and PE strike selectors. Each index retains its independent CE/PE selection across same-session refresh and index switches, resetting on a date change. Choices come from actual returned side-specific strikes across loaded expiries; an absent side/expiry contract stays absent. Other chapter calculations retain their existing selectors.

The three-index agreement card compares the selected side strike per index across every loaded recorded expiry, with a minimum of two expiries per index. A 🚨 🚦🚦🚦 badge requires all expiries in NIFTY, SENSEX and BANKNIFTY to record the same CE-or-PE PDH-up or PDL-down break in one exact common three-minute interval. Each crossing requires positive prices and unchanged ordered own-contract levels. Separate sides, levels, gaps or timestamps cannot combine. The card shows monitored strikes/counts and up to five latest matching session events, with historical events labelled separately from the latest interval.

Event context contains each index's India VIX previous/event value and direction, plus each exact expiry's provenance-qualified full PCR previous/event value and delta. Only exact event and previous buckets qualify; no later/current context substitutes. Missing context remains PARTIAL. “Strong recorded agreement” is descriptive, uncalibrated evidence: it does not assert exchange-wide expiry coverage, win probability, a trade decision, or execution authority. BANKNIFTY remains monthly observation. No feed, API, timer or database is added.

## Selector responsiveness

An unchanged ten-second health tick updates the health text without replacing the native premium selectors or recomputing the unchanged month board. Book content is keyed by recording/model references, controls and relevant context; a real data, selection, date or context change still rerenders. Explicit renders retain their force-refresh contract. Month-board calculations use their own source/window/month/strike cache, so changing the card's CE or PE does not recompute unrelated month boards.

Reading decoration measures all unmarked text first and applies font attributes in a separate write phase, avoiding a read/layout/write cycle per element. Already marked text skips repeated measurement; overlapping mutation targets are decorated once. Existing values, selector events, refresh cadence and data/trade authority are preserved. Validation covers unchanged-refresh DOM preservation, real index/data updates and read-before-write font batching.

Health ticks also avoid rebuilding unchanged detailed annex panels. A change in source freshness state still updates those panels, while recording and selection updates continue through the existing render paths. This prevents background detailed-panel regeneration from occupying the browser while a native premium selector is open.
