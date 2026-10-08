# DATA automatic snapshots and all-index graphs

Audited main: `4f8309c6908ba33c7ae396a690cfe4cdd5cf3057`.

| Decision | Existing component | Change |
| --- | --- | --- |
| REUSE | Replay market/chain rows, lineChart, existing Kite quote GETs | No backend or recorder changes |
| PATCH | INTRADAY composition and existing foreground 60-second refresh | Show all three index values, refresh stock/sector snapshots automatically |
| NEW | Compact all-index overview | Exact-expiry Full PCR and spot on separate charts |

Current gaps: PCR shortcut opened only the selected-index raw wall section. All-index spots were collapsed with raw futures tables. Kite stock/sector snapshots ran only on initial load or explicit click.

Each index now displays its latest sampled spot and exact-expiry Full PCR timestamp. Default expiry is nearest recorded unexpired for the selected session; explicit selection is preserved when available. Null latest PCR stays unavailable, without band-PCR fallback or carrying older values forward. Charts retain missing observations and disconnect gaps over the existing recording cadence. Graphs are expandable to keep all three current values compact on mobile. The PCR shortcut opens these graphs within INTRADAY; primary modes remain exactly three.

Quote refresh shares the existing automatic refresh preference, foreground guard and 60-second timer; busy and start-time guards prevent duplicate fetches. Quote response timestamps remain separate from replay observations; exchange freshness remains unverified.

Validation: 18 dashboard tests passed, including VM checks for all three cards, six separate charts, exact expiry, null PCR, primary navigation and quote refresh preference/visibility/singleflight/cadence. Local Devil Gate passed all steps including full regression suite. Mobile CSS is responsive; mobile browser screenshot verification has not been performed. Merge/deployment requires owner approval.
