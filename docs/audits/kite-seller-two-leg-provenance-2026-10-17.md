# Step 2 — Kite seller two-leg evidence audit (read-only)

## Existing, reusable paths
- `kite-websocket-binary-decoder.ts`: 184-byte FULL packet decodes exchange timestamp and five bid/ask depth levels; LTP/QUOTE packets do not provide verified full depth.
- `kite-immediate-token-registry.ts`: instrument token maps to symbol, expiry, strike and CE/PE. It rejects duplicate tokens.
- `h1-kite-exact-depth-adapter.ts`: validates one option's top bid/ask, timestamp chronology and registry identity; outputs `LIVE_RUNTIME_EXACT`.
- `h1-live-exact-snapshot-aggregator.ts`: validates one contract's exact price/depth and freshness.
- `seller-vertical-economics-shadow.ts` and `seller-research-evidence-bridge-v1.ts`: research-only seller arithmetic and caller-declared provenance checks.

## Devil Check (verified in repository code)
1. PASS: raw Kite FULL depth contains bid/ask; LTP is not bid/ask.
2. PASS: one-leg contract identity can be resolved through registry.
3. PARTIAL: timestamps are checked on individual packets; there is no verified seller two-leg Kite adapter mapping two independently identified packets into a shared immutable pair snapshot.
4. FAIL-CLOSED REQUIRED: existing seller bridge accepts caller-supplied snapshot and source strings; these are *not* independently verified Kite-origin evidence.
5. NOT VERIFIED: no broker-origin margin endpoint response was found by code search for `order_margins` or `marginRequired`. A user-supplied positive number must not be labeled verified broker margin.
6. NOT VERIFIED: sufficient executable top-of-book quantity for both legs, broker margin pairing and full charge schedule are not proven end-to-end.
7. PASS: seller modules are research-only and do not enable Kite orders, selector authority or Telegram.

## Next minimum implementation gate (do not wire dashboard yet)
- Reuse FULL packet decoder, token registry and depth adapter; bind *two different instrument tokens* to the exact same symbol/expiry/side and correct hedge direction.
- Validate both exchange timestamps and receive timestamps against a single cutoff; reject stale, skewed, future, crossed, or insufficient-size top-of-book quotes.
- Generate a deterministic pair snapshot identity from verified token IDs and timestamps; never trust a caller-provided `snapshotId` as proof.
- Independently validate broker margin provenance for the exact pair and size using an existing broker endpoint, if available; otherwise return `BROKER_MARGIN_NOT_VERIFIED`.
- Keep all outputs `RESEARCH_ONLY`; do not call seller candidate selector, order builder, Telegram or execution.
- Add synthetic fail-closed tests and CI before any production/dashboard integration.

**Scope:** audit only. No secrets, broker calls, orders, database migrations, deployments or production configuration changes.
