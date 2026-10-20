# CORTEX dashboard architecture — incremental integration

As of 20 October 2026. Baseline: merged PR #772 (`2eae50ffcc50e2ea8768230aee0966c857f108c4`).
The standalone CORTEX Multi-DTE HTML is a design reference with curated historical examples; it is not the production data authority.

## Implemented in this change

Chapter 03 gains a compact Multi-DTE awareness view using the existing One Shot installer and existing `atmExpiryLadder` payload.
The existing detailed CE/PE ladder stays accessible below it, collapsed initially.
The view uses actual subscribed expiry dates, ascending and capped at four, with calendar days from the source trade date.
It displays CE and PE LTP independently; a missing leg stays unavailable.
Day % is each exact contract's LTP versus its own broker previous close.
Selected-window % uses the existing 1/3/15/60-minute control and the existing bounded browser sample cache.
A baseline is at or before the target, with up to 15 seconds tolerance. Both pair endpoints must have CE/PE source times within five seconds.
The key includes index, token, expiry, strike and side; an ATM roll cannot inherit another contract's return.
This is an observed-endpoint comparison, not proof of continuous minute coverage.
BANKNIFTY remains labelled monthly observation.

## Data and rendering path

1. Existing Kite-backed dashboard feed supplies the existing shared stream.
2. Existing workspace envelope and quote validators gate the One Shot renderer.
3. Chapter projections use the same validated payload; this change introduces no fetch, subscription, recurring timer or provider.
4. Browser-only, bounded sample history supports observed window changes; it is cleared on runtime/session change or disconnect.
5. Existing recorded-ladder / multi-day tools remain the route to saved H1 data; live values and historical examples are not combined.
6. RAG explains retrieved evidence and its gaps; it has no authority to generate market values or contract identities.

## Source boundaries retained

- Full PCR remains under the existing complete-expiry verifier. ATM-band PCR cannot stand in for full PCR.
- Spot PDH/PDL and Futures references remain separate. Same-contract Futures previous-session high/low are still unavailable.
- Current-source time, quote state, contract identity and runtime/trade date remain required.
- Source-window tolerances and browser-session collection are visible. This view does not imply that background recording begins when a browser opens.
- No volume-buying inference, dealer positioning, predictive confidence or win-rate is added.
- No selector, verdict, Telegram, broker/order path, recorder, schema or persistence changes.

## Next bounded slices, not implemented here

1. Expose source-backed availability reasons consistently across expiry views before broadening metrics.
2. Reuse existing recorded endpoints for a separate before/event/after panel with explicit gaps and fixed-contract identities.
3. Surface existing memory/RAG evidence through the same selected index/contract context; inspect current wiring before adding any retrieval.
4. Resolve Futures PDH/PDL provenance separately before showing those values.

Commodity work remains paused. No new database or new background research task is required.

## Verification

Focused behavioral tests cover actual-date sorting, calendar DTE, duplicate/impossible expiry rejection, stale and wrong-contract withholding,
disconnect revocation, same-contract matched-window returns, ATM-roll isolation and pair source-time skew.
The existing production HTML compilation test and the existing shared-stream/no-network test also cover the new markup/installer.
CI results must be checked on the final PR head before merge.
