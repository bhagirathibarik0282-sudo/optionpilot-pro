# Compact Full / band OI PCR ladder — 18 October 2026

Status: implemented and tested locally; production and visual proof NOT_PROVEN.

Replaces the three Full PCR cards with three table rows: NIFTY, SENSEX and
BANKNIFTY. Each row has expiry, source-check time, Full OI PCR and Band OI PCR
with independent finite arrows. Full and band alignment badges remain separate.
One closed Source & band range drawer replaces three source drawers. No measured
screen-height reduction is claimed without actual desktop/mobile browser proof.

Both columns are PE OI / CE OI; Full uses all contracts in the complete expiry
inventory, while Band uses exactly 7 listed strikes on either side of snapshot
ATM: 15 strikes / 30 CE+PE contracts. This label is NOT a seven-strike band and
is NOT a second kind of OI. The premium strike selection does not move the ATM.

The existing sampler's already-fetched, validated full-expiry quote batch is
reused for band OI totals. The existing WebSocket spot cache supplies the ATM
reference; no provider call, socket, timer or persistence is added. ATM and band
range are frozen when each OI snapshot completes. The two PCR columns therefore
refer to the same completed OI sample and display cadence.

Full coverage must pass before band is eligible. Band additionally requires a
fresh, correctly identified same-session spot source/receipt, <=30s combined
source skew, all 15 listed strikes with both sides, finite totals and positive
CE denominator. Missing edges, missing spot, partial chain or bad totals show —.
A genuine zero PE total produces zero PCR. Bad/missing spot only withholds band;
valid full-chain values remain independently available.

Band arrows compare only unchanged ATM/range across consecutive qualified OI
snapshots. ATM migration resets band direction, leaving full PCR comparison
intact. Same-cycle mutation revokes band values. Separate band alignment requires
matching baseline/current cycles and cadence across indices, plus <=30s combined
OI AND ATM source skew at BOTH endpoints. An opposite full/band direction is
preserved as descriptive information; no combined score or trade vote is added.

Validation:
- Existing 221 tests plus 10 additional tests: exact dashboard command 231/231 PASS.
- New tests cover exact 15-strike totals vs full-chain totals; source/spot failure;
  edge/missing-side/zero-denominator rejection; zero PE; full coverage failures;
  frozen ATM with one broker batch; cache read freshness; opposite Full/Band
  alignment; band scope validation; ATM baseline reset; conflicting same-cycle
  band data; cross-index ATM timing. Serialized live-event regression covers
  both numbers and disconnect revocation without recorded mutations or requests.
- Full npm test PASS. Generated server/Telegram wiring artifacts restored.
- Generated scripts parse in dashboard tests; guardrails and git diff --check PASS.
- Actual production broker values and desktop/mobile visual proof NOT_PROVEN.

No recorded calculation, candidate, Telegram, order, seller execution, database,
configuration, merge or manual deployment change. BANKNIFTY monthly observation
and existing index-specific expiry selections remain unchanged. This is the PCR
ladder only; the earlier broader Columns/Wheel Wall Studio remains separate work.
