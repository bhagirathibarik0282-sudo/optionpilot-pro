# OptionPilot chapter renovation — 2026-10-17

Scope: renovate the existing 13-chapter dashboard sequentially in one reviewable PR. No new candidate authority, broker integration, database, provider request, trading rule, seller execution, or production configuration.

## Chapter list and implementation

| # | Existing chapter | Renovation in this change |
|---|---|---|
| 1 | Overview | Three source-labelled index cards; larger spot, day/window changes, PDH/PDC/PDL, independent CE/PE identities, recorded PCR, optional evidence. Missing values remain unavailable. |
| 2 | Spot + pivots | Reference levels before charts; optional existing verified pivot values; source and previous-session details stay expandable. |
| 3 | Premium comparison | Compact contract cards before the wide comparison table; exact table and individual charts expand independently; existing strike/expiry controls retained. |
| 4 | Four expiries | Each actual recorded expiry has its own group, compact CE/PE summaries and optional decomposition/charts. No assumed calendar or fourth expiry. |
| 5 | Futures | Readable price, basis, OI, OI change and time cells; existing expiry-continuity limitation stays explicit. |
| 6 | OI + walls | PCR/spot cells and separate call/put wall cells; current OI, migration and same-strike OI change stay distinct; coverage expands. |
| 7 | Notable changes | Category count/time tiles before the existing timeline; agreement and earlier context expand. Missing contract labels no longer render as `undefined`. |
| 8 | Premium behaviour | Always-visible active watch scope; optional filters/expiry/layers collapse; larger card labels, prices, levels and touch controls. Live/recorded and seller panel behavior retained. |
| 9 | Sectors + stocks | Larger breadth counts, leaders, percentages and source text; existing returned-subset denominators and independent quote times retained. |
| 10 | Spot + full PCR | Larger controls and chart labels; independent index/series switches retained; three-index cards stack at narrower widths instead of forcing horizontal chart scrolling. |
| 11 | FII / DII | Unit-labelled stored EOD cash-window cards with source date separate from selected market date; participant/source and separate market context expand. |
| 12 | India VIX | One primary VIX recording rather than three apparently independent indicators; actual qualified VIX chart points; separate premium context and optional three-recording comparison. |
| 13 | Combined context | Existing measured spot/CE/PE/PCR/futures/VIX changes in time-labelled cells; existing interpretation/cash context expands; no new score or votes. |

## Shared reading system

- Existing chapter names, navigation, hide/show preferences and source selectors remain intact.
- Chapter header identifies recorded, separate quote-snapshot or stored EOD scope; the existing live feed stays separate.
- Larger figures, labelled units, responsive cards and optional reading/evidence disclosures reduce text density.
- Overview and multi-index comparison layouts have explicit narrow-screen rules; touch controls remain at least 44px where updated.
- No stale data is converted into a live value; costs remain labelled estimates in the unchanged seller research flow.

## Data and authority boundary

Only `market-book-view.ts`, `premium-workspace-view.ts` and the existing model's VIX chart projection are changed in the product. VIX points use the same existing qualified market rows and session endpoint helper as the other charts; nulls and exact source timestamps are preserved. No market values, percentile rules, source qualification, interpretation bias, candidate selection, Telegram, orders or broker session behavior are changed.

## Verification

- Six new tests render all 13 populated and empty chapter states, check source-record immutability, independent CE/PE expiry identity, actual zero versus missing/unverified PCR, EOD versus market dates, one-series VIX semantics and exact/null VIX points.
- Existing chapter, premium workspace, replay, dashboard and live-stream tests are run with the new tests.
- Browser script syntax, permanent guardrails, full npm regression and exact dashboard/RAG/seller workflow commands are checked before PR delivery.
- New chapter layout has not been deployed. Actual desktop/mobile visual validation of this revision remains NOT_PROVEN; no screenshots or browser-rendered visual proof are claimed. Live market readiness is separate from presentation rendering.

Verified local results: full `npm test` PASS; complete Business Dashboard workflow command 184/184 PASS; RAG workflow command 146 PASS, one skipped, zero failed; Seller workflow command 180/180 PASS; six new chapter tests PASS; five generated browser scripts parse; permanent guardrails and `git diff --check` PASS. These are source/rendering checks, not production visual proof.
