# Step 2 — Kite seller evidence provenance audit (2026-10-17)

Scope: read-only audit. No seller candidate promotion, order placement, runtime wiring, deployment or configuration change.

## Verified from existing source
- `seller-vertical-economics-shadow.ts` computes credit using short bid minus long ask; validates hedge direction, credit, quote age, positive net credit, capital and supplied margin.
- `seller-research-evidence-bridge-v1.ts` checks distinct opaque contract IDs, matching expiry strings, snapshot IDs, quote-contract IDs, leg timestamp skew, and declared source labels.
- `test/seller-research-evidence-bridge-v1.test.ts` already exercises missing/mismatched identifiers, expiry, stale quotes, and skew; dedicated CI exists.

## Devil Check: unproven, must fail closed upstream
1. `BROKER_BID_ASK` and `BROKER_MARGIN` are caller-provided string literals, **not cryptographic or broker-verified provenance**. A forged caller can set these strings.
2. Opaque short/long contract IDs are not independently resolved against Kite exchange, instrument token, trading symbol, expiry, strike, option type, and lot size.
3. `marginSnapshotId` matching is not proof that Kite's margin API evaluated the exact two-leg basket, quantities, side and current broker account.
4. `shortObservedAtMs`/`longObservedAtMs` are caller-supplied; the bridge does not independently authenticate exchange timestamps, receive timestamps, or packet freshness.
5. No evidence here proves live broker market depth quantity, executable fill, or availability of capital after other obligations.

## Release gate
Do not call a seller card executable or promote it to any selector until a trusted Kite adapter proves both leg identities, depth provenance, independent timestamps, and basket-margin response linkage. Any missing/mismatched evidence must remain BLOCKED. Existing `RESEARCH_ONLY` is not an order authorization.

## Existing regression command
`node --import tsx --test test/seller-vertical-economics-shadow.test.ts test/seller-research-evidence-bridge-v1.test.ts`

This audit is documentation-only by design. No code change is justified before a trusted upstream Kite evidence path is identified and tested. CI result is not claimed without a recorded run.
