# Recorder matched outcome rate — deterministic core

Status: implemented as an internal pure calculation and fixture-tested. No
historical retrieval adapter, HTTP route, dashboard number or production
deployment is enabled by this change. No actual Recorder match rate is claimed.

The existing trade-plan probability engine uses target-before-stop outcomes.
This core instead consumes admitted saved Recorder snapshots and measures the
selected fixed-contract premium's endpoint change over an explicit horizon.
Do not label its result as a trade win rate, profitability or calibrated forecast.

## Implemented matching scope

- Source: existing Postgres H1 Recorder premium snapshots admitted through the
  existing Recorder event-context projector; both quote identity and availability
  guards remain in that source path.
- Match the same index, CE/PE side, calendar DTE, event minute and sign of the
  spot-to-strike difference adjusted for CE/PE. Calendar DTE is not trading DTE;
  strike sign is a coarse moneyness condition, not delta or exact ATM distance.
  Strike/expiry can differ between historical episodes; each episode keeps its
  own fixed-contract before/event/outcome journey.
- Initial optional features are exact eligible 3-minute premium-change direction
  and recorded spot position relative to PDC. Selected features must all exist
  and match. O=H, PDH/PDL crossings, PCR, wall migration, sector matching and
  multi-DTE features are not implemented in this core and cannot be silently
  selected or substituted. Unknown requested features block calculation.
- Only earlier sessions enter the historical pool. Current/future sessions are
  excluded. Outcomes cannot enter matching features. The rule must be declared
  and versioned by the target event's known-at timestamp.
- Deduplicate identical event copies. Conflicting copies with the same event
  identity block a numeric result, even when their claimed hash is identical.
- Select the earliest available matching episode per prior session before
  evaluating outcomes, with an event-identity tie break. Missing outcomes cannot
  cause selection of a later successful episode from that session.

## Calculation and evidence

Require an explicit version, declaration timestamp, feature set, 3/15/30-minute
horizon, increase/decrease condition, positive minimum premium move, and minimum
number of distinct matched sessions. There is no production/default support
threshold or active rule. Configuration must be agreed and audited before use.

Require a complete, non-truncated history scope with no failed sessions from an
audited Recorder loader. The scope object is a trusted internal loader contract,
not proof supplied by an end user or LLM. Do not expose this calculator as a
public JSON-input route. The loader adapter itself still needs implementation
and actual-source validation before a dashboard probability can be enabled.

Compute qualifying completed episodes divided by completed selected sessions.
Reject numeric output when selected outcomes, match features or admitted source
evidence are missing/conflicting, or support is insufficient. Report diagnostic
counts, source sessions, Recorder event IDs, exact contract identity, source
fingerprints, known-at/outcome availability times, endpoint prices and the rule.

Return an approximate 95% Wilson score interval, with bounded zero/all-success
endpoints. Formula reference: [NIST confidence intervals for proportions](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm).
One-per-session selection reduces overlap but does not prove statistical
independence across sessions. Keep this limitation visible when interpreting
the interval or comparing rules.

RAG similarity, LLM confidence and caller-supplied comparison percentages are
not inputs to the rate. UI wording must remain `Historical matched outcome
rate`, show numerator/denominator and horizon, and retain `Probability
unavailable` until the real loader and support qualification are validated.

## Validation and authority

Twenty-four tests passed: eleven core tests and thirteen existing Recorder bridge
tests. Synthetic fixtures exercise numerator/denominator, exclusion/matching,
look-ahead, unsupported/missing features, duplicates, conflicting claimed hashes,
outcome-blind session selection, missing outcomes, complete-scope requirements,
explicit rule/support, endpoint direction/horizon and interval boundaries.
The fixtures are not historical market results or evidence of an actual match
count. No source arrays are mutated. No DB query/write, broker call, selector,
Telegram or execution change is introduced.

## Double-check repair

Adversarial tests reproduced two errors in the initial core: a mathematically
exact 10% decrease missed an inclusive 10% threshold due to binary floating-point
rounding, and a tiny positive premium move matched a flat case after the display
delta rounded to zero. Outcome qualification now compares the supplied decimal
price/threshold values with scaled BigInt arithmetic. Match direction uses the
admitted raw endpoint prices while still requiring the existing eligible 3m
baseline/delta guard. Display percentages do not select matches or qualify wins.

Tests cover exact decimal/exponent boundaries and values just below a threshold.
Non-finite calculated outcome changes and missing explicit no-write attestation
also block a numeric rate. This repair remains internal; actual Recorder history
loading, browser acceptance and numerical dashboard activation remain pending.
