# Step 3 — Existing Kite adapter reuse and seller provenance gate

Read-only source audit; no runtime changes, seller execution, orders, configuration, or deployment.

## Verified existing adapter
- `h1-kite-exact-depth-adapter.ts`: accepts Kite FULL non-index packets only; resolves option token through `KiteImmediateTokenRegistry`; checks option side, symbol, expiry, strike; extracts top-of-book bid/ask and quantities; rejects invalid or future exchange timestamps relative to receive timestamp.
- `h1-fixed-contract-option-snapshot-bridge.ts`: additionally checks quote age against supplied policy and preserves observational-only row status.
- `test/h1-kite-exact-depth-adapter.test.ts`: covers missing/crossed depth, unknown token, future/missing timestamps, non-FULL packets, and zero quantity evidence.
- `seller-research-evidence-bridge-v1.ts`: existing seller research-only bridge; does **not** consume an independently authenticated Kite two-leg basket-margin response.

## Devil Check — release blockers
1. Per-packet Kite depth is **not** a complete synchronized two-leg quote; assemble by explicit instrument token with both legs separately checked for exchange/receive freshness and skew.
2. Zero displayed quantity is allowed as observational evidence by the depth adapter; **must not** be interpreted as executable liquidity. Check short bid and long ask quantities against intended order quantity.
3. Existing registry resolution does not by itself prove margin calculation for exact exchange/tradingsymbol, BUY/SELL, quantity, product, account, and timestamp.
4. Repository code search did not locate a Kite basket-margin API integration (queries `margins/basket`, `order_margins`, `basketMargins`); absence from search is not proof of complete absence. Require source inspection before claiming integration.
5. A caller-supplied `BROKER_MARGIN` label and numeric margin cannot authenticate Kite's broker response. Reject unverified/missing/mismatched basket margin.
6. Depth adapter checks timestamp ordering but does not impose an age threshold by itself; apply an explicit freshness policy in the downstream seller adapter.

## Next minimal implementation boundary
Reuse the existing registry, packet decoder, depth adapter and seller research bridge. Introduce only a tested read-only two-leg evidence assembler after locating a trustworthy broker margin adapter. No seller selector promotion, Telegram buyer changes, or execution enablement.

## Existing tests (not claimed executed)
`node --import tsx --test test/h1-kite-exact-depth-adapter.test.ts test/seller-vertical-economics-shadow.test.ts test/seller-research-evidence-bridge-v1.test.ts`

## PR #700 follow-up Devil Check
- Reproduced malformed JSON crashes for non-string IDs, exchange and trading symbol; added regression coverage and runtime type guards.
- Reject impossible calendar expiry dates and duplicate trading symbols across the two legs.
- `verified` denotes structure only. Every result explicitly includes `structureOnly: true` and `brokerProvenanceVerified: false`; broker provenance remains NOT_PROVEN. Caller-controlled timestamps and age limits are not an independent freshness policy.
- This validator has no production callers. It cannot establish same underlying, product, account, lot size, trusted request/response linkage, broker margin authenticity, or execution readiness. Those remain blocked pending the trusted adapter.
- Local verification: 59 focused tests PASS (depth adapter, seller economics, bridge, fail-closed cases and margin validator); `npm test` PASS; permanent guardrail check PASS; `git diff --check` PASS.
- No broker calls, runtime wiring, selector promotion, orders, configuration changes or deployment.
