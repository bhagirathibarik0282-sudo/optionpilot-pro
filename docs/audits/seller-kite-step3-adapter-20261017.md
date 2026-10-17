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

## Next boundary — on-demand Kite basket-margin reader
Status: PARTIAL. Local mocked tests are not live broker proof.

- `seller-kite-basket-margin-reader.ts` reuses the existing shared session authority and instrument-master parser/fetch adapter. No startup hook, HTTP route, scheduler, selector, Telegram, database, or order path is added.
- It verifies `/user/profile` account identity under the same credentials, resolves each token uniquely in a freshly fetched master, and checks exact underlying, exchange, option segment/type, expiry, strike direction, matching lot size and whole-lot quantity. Research scope is NIFTY/SENSEX only; no BANKNIFTY policy is introduced.
- It submits hedge-first descriptors to `POST /margins/basket?consider_positions=true` only, preserving product and quantity. Redirects are rejected, paths are fixed, and requests have an 8-second timeout. This endpoint calculates margins; it does not place orders.
- Both `initial.total` and `final.total` are retained. `conservativeMargin` is their maximum, an observational estimate only; it does not prove sufficient capital, fill sequence, available balance or execution readiness. Position-aware results can change with the broker account's positions.
- Kite's documented basket response echoes exchange/tradingsymbol but does not independently echo every request attribute or provide a documented unique response ID. Product, BUY/SELL, quantity, snapshot and account are bound to the locally submitted HTTPS request; local request/receipt IDs are explicitly local. Request, response and account digests are audit correlators, not broker signatures.
- The reader rechecks the authority session after reading the response. Session/account changes, malformed responses and a total context age exceeding the fixed 10-second policy fail closed. Caller-supplied age limits are not accepted. A later consumer must recheck age and exact request linkage; successful read-time checks cannot remain valid indefinitely.
- Any injected dependency labels output `TEST_ONLY` with `brokerProvenanceVerified:false`. Default HTTPS operation can establish transport provenance when invoked successfully; no such live invocation has been performed here. All results remain research-only and `executionReady:false`.
- Validation: 37 new mocked reader tests; 96 focused tests total PASS; full `npm test` PASS; permanent guardrails PASS; `git diff --check` PASS. Positive cases cover CE, PE, NIFTY, SENSEX, NRML/MIS, and request immutability. Rejections cover account/session mismatch, malformed or missing margin, wrong/duplicate response legs, stale/reversed time, invalid token/expiry/lot/hedge and unsupported inputs.
- Still NOT_PROVEN: real authenticated broker readback, synchronized two-leg live depth/liquidity, durable runtime evidence and integration into the existing research card. This change grants no candidate or execution authority.

Official API contracts checked on 2026-10-17:
- https://kite.trade/docs/connect/v3/margins/
- https://kite.trade/docs/connect/v3/user/


## Integrated seller research card — single release boundary
Status: PARTIAL. Code and mocked integration checks do not prove production market readiness.

Chain: existing dashboard FULL packet cache → existing exact-depth adapter → same-account Kite basket-margin reader → broker equity net capital → existing seller research/economics builder → collapsible panel in Premium behaviour.

- The user explicitly chooses one NIFTY/SENSEX pair, quantity and MIS/NRML product; this is not automatic candidate selection. An explicit round-trip cost estimate is required, labelled as an estimate rather than a live broker fact. BANKNIFTY, buyer candidate authority and buyer Telegram are unchanged.
- Retains only the latest raw packet per subscribed token in the existing bounded cache. No second socket, new database/table, scheduled broker request, tick history or database writes are introduced.
- The private `/api/account/kite/seller/options` and POST `/api/account/kite/seller/research` routes use the existing cookie session. The POST requires same origin and JSON, bounds payload size, permits one in-flight request per process and enforces an eight-second cooldown. No account data or broker-triggering route is added to the public research router. GET options never calls the broker.
- Live feed credential must match both the browser's account session and shared session authority. The margin result must match the current account/session digest, server-generated snapshot ID, both exact tokens, exchange/symbol, expiry/strike/side, direction, product and quantity. Authority and feed continuity are rechecked after awaited broker operations.
- Each leg must have a valid FULL packet, non-crossed depth, exchange/receive times no older than five seconds, no future times, leg skew within one second, and short bid / long ask quantity covering the requested size. Fresh depth is re-read after margin/funds responses; a pre-request quote cannot stand in for a current quote.
- Capital comes from authenticated `/user/margins/equity` `net`; no available-balance or cost default is invented. The existing economics builder checks credit, after-cost maximum loss and the conservative maximum of initial/final basket margin. This remains a research estimate, not available cash verification or an execution authorization.
- Browser results carry a bounded validity deadline; expired values, disconnected feeds, changed inputs and background-resume invalidate the proof. Local TEST_ONLY source labels remain visible. Broker reads occur only on explicit pair checks; there is no automatic trading or broker polling.
- Results are always research-only, PARTIAL/BLOCKED, `executionReady:false`, `affectsSelector:false`, `affectsTelegram:false`, `affectsExecution:false`, `createsOrders:false`.
- Validation: 24 integration tests; 152 focused tests total PASS; full npm regression PASS; permanent guardrails and diff checks PASS. Five generated dashboard scripts parse successfully. DOM checks PASS for explicit action only, TEST_ONLY label, displayed metrics, expiry clearing and disconnection revocation. Actual Chromium visual/mobile screenshot checks were unavailable because the browser binary download failed; responsive layout is implemented but not visually proven here.
- Remaining release proof: approve merge/release; verify the existing dashboard live flag/session and deployed route; perform a real authenticated pair read during an open session. Real Kite margin/funds, synchronized live liquidity, actual production UI layout and durable outcome journaling remain NOT_PROVEN. No order path is enabled. No new retention burden is introduced.
