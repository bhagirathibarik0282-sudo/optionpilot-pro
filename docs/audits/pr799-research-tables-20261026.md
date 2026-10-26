# Compact recorded Research tables — 26 October 2026

Research overview now starts with three numbered sections using existing derived
market-book models: Spot & Futures levels for all three indices; recorded PCR
and OI-wall context for all three indices; exact-contract premium rows for the
selected index/strike across the first four available recorded expiries. The
premium section explicitly reports the shown/available expiry count. Existing
index cards remain inside a closed detail drawer with their source evidence.

Each metric keeps its own recorded endpoint/window, exact contract and expiry.
PCR numbers require the existing admitted archived/normalized full-chain source
label; that label does not prove full-chain inventory or current quote freshness.
Wall timestamps are separate from PCR timestamps. Futures expiry continuity,
contract-specific levels and opening ranges remain unavailable. Spot opening
range requires existing complete-coverage admission. BANKNIFTY stays monthly
observation. No new fetch, database operation, probability or trading authority.

Validation: 167 relevant local tests passed. A new serialized production-script
regression checks the three sections, exact CE/PE identities, missing-index
states, rejection of unverified PCR numbers, missing futures levels and no added
requests. The actual saved Recorder capsule also rendered three sections and
the 23150 PE / 142.90 endpoint in a VM without database reads. This is not an
actual browser/mobile visual check. Patch whitespace check passed.

This implements three table sections, not the full seven-section reference.
Combined heavyweight/sector, notable-event and matched-history sections remain
unfinished. Main merge/deploy and numerical probability activation are pending.
