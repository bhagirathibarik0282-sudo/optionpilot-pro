# OptionPilot Stable System — Release Contract
Version: 2026-11-02. Status: **stabilization in progress; production is not accepted**.

## Purpose
Stop repeated screenshot-specific fixes. Every production release must pass a
cross-module acceptance gate *and* live observation. Green CI is not evidence
that a broker, exchange quote, or Telegram recipient worked in production.

## Non-negotiable source and safety invariants
1. NIFTY and SENSEX weekly contracts are business/research candidates.
   BANKNIFTY monthly is research/observation only. No live order enablement.
2. Data identity includes index, expiry, strike, CE/PE side, exchange and token.
   Exchange timestamp, local receipt timestamp and snapshot window stay distinct.
3. Full *fresh* PCR requires every expected valid contract and the existing
   30-second exchange freshness/source-skew checks. *Complete reported* PCR
   is labelled mixed-time, not a fresh-alignment input. Prior-session or
   pre-open packets are labelled earlier, not current. Null is not zero.
4. Broker disconnect, wrong index, identity mismatch, missing OI, duplicate
   contract and expired snapshot must revoke qualified values. Do not borrow
   a ratio from another index or from recorded mode.
5. Dashboard, recorder and Telegram must use compatible source snapshots and
   dates. Source card HTML scraping is a temporary compatibility path, not
   the target architecture; replace it with canonical typed source objects.
6. Recorder and replay must preserve exact 1m/3m contract identity and time.
   No interpolation to fill gaps, invented win rates, or unauthorized orders.
7. Telegram ladder SHADOW is not a delivery receipt. Eligibility failures
   cannot be bypassed to force a message or trade.
8. FII/DII previous-session context must retain its true date. A 503 caused
   solely by current-session official data not yet published is not a crash.
9. EOD Drive retention only after checksum-verified archive readback.
   Maintain known-good rollback and startup/scheduler checks.

## Unified release flow
- [x] Inventory current production and identify an exact rollback deployment.
- [x] Add cross-module deterministic source reconciliation tests.
- [x] Configure a single cross-module CI run for PRs targeting production.
- [ ] Make final code changes on the existing integration branch rather than
      creating new micro-PRs for each symptom.
- [ ] Pass the gate **on the final commit**, including 360px/390px UI CI.
- [ ] Collect 7–9 trading-session independent production observations: per-
      index expected OI, fresh, same-session reported, old, missing and invalid;
      exact CE/PE 3m readiness; Telegram actual send/delivery state; recorder
      and replay parity; FII/DII; EOD archive checksum; runtime health.
- [ ] Verify a controlled after-market canary, HTTP readbacks and one-click
      rollback before declaring the integrated release accepted.

## Baseline: observed 2 Nov 2026
Railway production service online, 1/1 replica, commit
`2f38f331d925f0d402520674c9d70f3a9d13eef7`,
deployment `d6df7245-ad87-44e5-8dc1-d35670b400b1`.

A 49-cycle read-only PCR window showed nearest-expiry synchronized fresh
NIFTY 9/49, SENSEX 0/49, BANKNIFTY 0/49; complete reported same-session
coverage for each index 49/49. This does not prove future availability.

Exact CE/PE 3m Telegram watch was NOT_READY across 90 sampled checks,
while the new ladder was still SHADOW-only. Last verified EOD Oct 30
archived 127,703 records; this does not prove every individual recorded
minute. Dated Oct 30 FII/DII ingestion succeeded.

PR #835 retains an undeployed mobile PCR display change. Do not merge
until the integration gate and production safety review pass.

## Acceptance definition
No release on a red test, unresolved cross-index/data identity regression,
unverified rollback, or unexplained change to execution/Telegram gating.
Test fixtures never count as forward-market proof. Mark each condition
PASS, FAIL or UNVERIFIED; do not convert UNVERIFIED to PASS.
