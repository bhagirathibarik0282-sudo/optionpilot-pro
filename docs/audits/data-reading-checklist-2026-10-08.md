# Intraday Reading Checklist

Audited main: `da06bfd4d371291ae18b49dc32964b83c8cc0dc5` (#623).

| Decision | Component | Scope |
| --- | --- | --- |
| REUSE | deriveDataAnnex, replay option/market/chain rows, timestamped events, existing stock/sector snapshots | Existing exact-contract comparisons and source timestamps |
| PATCH | INTRADAY data composition | Add plain Odia explanations beside measured values |
| NEW | Reading Checklist card and pure serialized UI helper | No eligibility, scoring, candidate, backend or database engine |

The card presents timestamp coverage; spot/futures/VIX; premium/PDH/PDL/OI/IV/DTE/opposite premium; PCR/wall events; quote breadth; and liquidity. Each section starts compactly, with extra values expandable. Definitions stay expanded across refreshes. Only INTRADAY shows the card; the three primary modes remain unchanged. Comparison window comes from existing Current / 3m / 15m / From Open controls.

Opposite options require the same index, expiry and strike, with exact selected-option timestamps at both interval endpoints. No nearest-point substitution or contract stitching. Direction descriptions compare measured signs only and explicitly reject differing endpoints. Null latest values are not filled from previous observations. Quote breadth has an available/returned denominator and response timestamps; previous-close snapshots are not represented as replay interval alignment. VIX is distinct from contract IV. Futures expiry continuity remains unverified. Bid/ask spread requires valid positive bid and non-crossed ask; depth and executable quantity are unavailable in this replay. Volume is labelled daily cumulative and recorded quote age is not represented as current live age. Events are existing records only.

The guide explains source-backed options basics, not a researched profitable trading strategy. Sources:
- https://www.optionseducation.org/optionsoverview/options-pricing
- https://www.optionseducation.org/news/open-interest-why-it-matters
- https://www.optionseducation.org/news/understanding-the-bid-and-ask-prices-for-options
- https://www.nseindia.com/static/products-services/indices-indiavix-index

Validation: 25 dashboard tests passed, including exact opposite identity/time isolation, latest nulls, valid spread, missing baselines, Current mode semantics, differing-endpoint descriptions and missing quote denominators. Existing browser VM test verifies Odia rendering, mode visibility and guide preservation. Local Devil Gate passed including full regression suite. Visual verification in a mobile browser remains pending; no screenshot verification claim. Backend wiring mutations produced by npm test were excluded from this UI patch. Merge/deploy requires owner approval.
