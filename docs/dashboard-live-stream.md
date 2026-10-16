# Display-only live market stream

Status: PARTIAL — local behavior tested; production activation and live tick acceptance pending.

The dashboard now has a separate LIVE section above recorded research. Server-side Kite FULL packets update Spot, selected exact CE/PE premiums, option and futures OI/volume, bid/ask, nearest futures, synchronized futures basis, VIX, configured heavyweight/sector quotes and full-expiry OI PCR/walls. Numbers and charts update through one SSE stream per visible browser, coalesced to one second. IV/Greeks are explicitly unavailable from this tick source. PDH/PDL and recorded research remain in their existing reference/evidence views; they are not replaced by tick-derived historical data.

## Runtime activation

Explicit default-OFF flag: `DASHBOARD_LIVE_ENABLED=true` on the existing Railway app service. The server reuses existing encrypted Kite session authority, API key, instrument-master adapter, decoder and WebSocket transport. It creates one display-only socket per process, subscribes in FULL mode and disables the transport's global observer fanout. It does not enable the dynamic H1 selector or shadow chain. No live orders, Telegram, recorder, database schema or persistence change. Existing 3m recorder continues unchanged.

Credentials stay server-side. The runtime retries at most once per minute and closes outside the reviewed market calendar. Session renewal triggers a contained reconnect. The master supplies exact tokens, names, expiries, strikes and sides; no tokens are inferred. Spot identities match the existing exact index mapping; stocks/sectors reuse the existing quote-symbol list. The nearest listed future is explicit. Up to four listed expiries per index are considered. Complete expiry inventories are allocated round-robin across the indices within a 3,000-token connection budget; an expiry that does not fit is omitted whole and reported. This is not a claim to support every exchange expiry. BANKNIFTY remains monthly observation.

Only FULL packets with valid same-session exchange timestamps are ingested. Price requires positive finite values; OI zero is valid. Future timestamps beyond 5 seconds and backwards timestamps are rejected. A quote becomes stale at 30 seconds by source or receipt age; live numeric values are withheld. PCR/walls require every instrument in the selected master expiry inventory to have fresh OI, both sides, and source skew <=30s. Zero CE total yields no PCR. Wall ties remain explicit in JSON. Futures basis requires <=5s endpoint skew. No interpolation or fabricated motion. No partial CORE/ATM chain is called full PCR.

GET `/api/research/dashboard-live` returns the state and bounded selected-contract snapshot. GET `/api/research/dashboard-live/stream` streams it once a second. Exact selectors: `NIFTY_expiry`, `NIFTY_strike` (likewise SENSEX/BANKNIFTY). Invalid or unavailable explicit contracts never silently select another. The browser initially pins the nearest strike once a fresh Spot arrives, then reconnects with exact selectors; it does not drift with ATM changes. One stream per browser, max 8 concurrent streams per process, 15-minute connection rotation. Abort cleans up the slot. This does not trigger broker REST calls per browser.

Tick state retains one latest packet per registered token (<=3,000), no tick database writes. Browser charts retain <=600 points per series. Restart resets runtime ID/history. Disconnect/stalled stream hides numeric live values. Hidden/pagehide closes the stream; visibility/pageshow/online reconnects with a fresh snapshot. Open selectors survive while numbers/charts update. Recorded data and RAG are not contaminated by incomplete live intervals.

## Acceptance before calling the feature live

1. Observe terminal deployment SUCCESS for the intended merge SHA.
2. Enable only the display flag after approval; retain H1/execution flags unchanged.
3. GET live state: enabled, socket OPEN and fresh same-day Spot packets for all indices.
4. Observe advancing source timestamps and changed actual values on two snapshots; a connected socket alone is insufficient.
5. Verify exact selected option identity, futures, VIX and participation timestamps. Inspect full-PCR expected/fresh counts; missing contracts remain missing.
6. Verify browser rendering, expiry/strike switching, tab resume and stale behavior using the actual production stream.
7. Rollback: set only `DASHBOARD_LIVE_ENABLED=false`; existing recorded research continues.

No all-fields-live claim is made until field coverage is observed. Thin or illiquid option inventories may leave PCR unavailable under the strict freshness gate. Public websites are not used for market values.
