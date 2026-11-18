# BANKNIFTY shadow implementation v1

A complete standalone **paper execution core and validated JSONL bridge**, with a manual runner and the existing dashboard's encrypted Kite-session reader. No broker execution adapter exists. LIVE modes are rejected before any connection. No dashboard, scheduler, Telegram, npm start command, existing table or production service is changed by adding this directory.

This is not a production LIVE trading release. The read-only snapshot source can derive qualified signal events, but it is not automatically wired into dashboard startup or execution. Connecting the existing signal/feed producer and observing it in Railway remain deployment work. The JSONL boundary is explicit so missing IV or opposite-contract evidence is rejected rather than invented.

## What is implemented

- Frozen config with strict integers, finite numbers, compatible `contract_lot_size` and `qty`, exact contract/master matching, nearest-expiry ATM±1 selection and Decimal BUY-limit rounding down.
- Original -6 pullback, -22 stop, +15 trigger, +2 trail, +32 target and 20-minute holding parameters are retained by default. The configurable 15:20 IST cleanup is new operational policy, not a claim about the old backtest. Entry windows retain 09:20–11:30 and 13:00–14:45; expiry afternoon entry ends at 13:30.
- One active paper intent per account/strategy, price-times-quantity plus estimated cost capital reservation, unique signal IDs, symbol cooldown and persisted daily stop counts.
- Depth-limited partial entries/exits in whole contract lots. Entry fills use observed ask at or below the limit after minimum simulated latency measured from paper-order creation, using both exchange and receive timestamps. Pre-intent quotes cannot fill or invalidate an order. Stops/targets use bid with positive displayed quantity. VWAP invalidation applies only while an entry remainder is pending, not as a new exit rule after full fill. Exits wait for a valid depth event whose exchange timestamp is later than the exit request and can fill partially. No stale-LTP emergency fill is invented when quotes disappear.
- Independent watchdog thread, quote validation, duplicate/out-of-order rejection, expiry checks, entry/holding deadlines, day rollover and shutdown cleanup.
- PostgreSQL session advisory ownership lock, transactional compare-and-swap snapshots, separate append-only events and a unique signal ledger. No raw tick retention. SQL migration is additive and explicit. SQLite is used only by tests.
- Restart conservatively cancels an unfilled paper entry. Filled paper exposure enters reconciliation and exits only against fresh valid bid depth; it is not discarded. This is **paper recovery**, not broker-position reconciliation.
- Estimated P&L uses simulated fill notionals, with exit-fill attribution by IST execution date and one configurable estimated trade cost. Unfilled cancellations cost zero in this model. Actual brokerage/charges are not claimed.
- The session reader uses existing `kite_session_authority`, AES-256-GCM envelope and SHA-256-derived key. It validates expiry, fingerprint and broker user identity. Only profile and instrument-master GET endpoints are allowed; no environment-token fallback, schema mutation or secret output occurs in this reader.

## Tests

From repository root, Python 3.10+:

```sh
python -m pip install -r bnf_shadow/requirements.txt
python -m unittest bnf_shadow.test_bnf_shadow bnf_shadow.test_snapshot_source bnf_shadow.test_depth_source -v
```

The Python suite uses temporary SQLite journals and synthetic broker/auth fixtures. No Railway connection or real order is used. It covers validation, caps, signal deduplication, partial fills, exit confirmation, zero depth, watchdog, stale/duplicate ticks, timeouts, restart, CAS conflicts, concurrent signals, stop counters, session compatibility and broker-method isolation.

Optional PostgreSQL-engine SQL smoke test, in a disposable checkout:

```sh
npm install --no-save --package-lock=false @electric-sql/pglite
BNF_SHADOW_SQL_TEST=true node --test bnf_shadow/test_postgres_sql.mjs
```

This validates the migration and transactional SQL semantics, not psycopg network behavior or advisory-lock ownership across real PostgreSQL sessions. Those require an isolated PostgreSQL integration environment before deployment.

## Manual initialization and replay

Use an isolated PostgreSQL database for initial verification. `DATABASE_URL` is required. Do not use a production database for the first run.

```sh
python -m bnf_shadow --config bnf_shadow/examples/one_lot.json \
  --replay --input bnf_shadow/examples/synthetic_events.jsonl \
  --instrument-master bnf_shadow/examples/synthetic_master.csv --master-date 2026-11-18 \
  --init-schema

python -m bnf_shadow --config bnf_shadow/examples/one_lot.json \
  --replay --input bnf_shadow/examples/synthetic_events.jsonl \
  --instrument-master bnf_shadow/examples/synthetic_master.csv --master-date 2026-11-18
```

The example is fictional and produces a simulated +885 INR with one lot of 30 and 75 INR estimated cost. It does not use the user's 109 real backtest trades. At EOF a genuinely unresolved paper trade remains journaled; no final price is fabricated.

## Real-time SHADOW worker interface

Required existing variables: `DATABASE_URL`, `KITE_API_KEY`, `KITE_SESSION_ENCRYPTION_KEY`. Leave `EXECUTION_MODE=SHADOW`. The key must be the existing dashboard encryption key; do not generate or rotate it for this module. The account scope is resolved from the verified shared authority.

After reviewing/applying the additive schema in the intended database, a trusted producer can pipe JSONL to:

```sh
python -m bnf_shadow --config bnf_shadow/examples/one_lot.json
```

Each line is an object with `type: signal` plus a `signal` object, or `type: tick` plus a `tick` object. See synthetic_events.jsonl for exact fields. For real time the worker supplies its own current clock; input `now` is only used by replay. Lines are capped at 32 KiB and queued with bounded capacity. Invalid evidence is rejected without printing it. The session is rechecked every 30 seconds; on failure the worker stops and journals unresolved paper exposure.

Producer responsibilities:

- Supply the selected contract and opposite option of the same strike/expiry with synchronized spot/VWAP and IV evidence. IV and IV change must use the same declared units and method; IV change must be positive. Kite quote packets alone do not establish this IV input.
- Provide an exact same-session 180-second baseline, +12 or greater premium change, decreasing opposite premium and decreasing opposite OI. The engine checks supplied evidence, not its derivation or truthfulness.
- Supply fresh bid/ask depth with unique source event IDs, aware exchange/receive timestamps and quantities in units, not lots. One displayed book may still overstate executable liquidity; queue position and hidden market activity remain unknown.
- Use session-specific instrument-master data. Lot size must match the config, otherwise entries reject. The sample's 30 is a fixture, not a claim about every BANKNIFTY expiry.

## Limits and release gates

- There is intentionally no LIVE adapter, real cancellation, market-order fallback, broker stop management or actual-fill P&L. The package cannot be enabled for LIVE by an environment switch.
- No end-to-end 109-trade parity proof is included. A single-position, cooldown-controlled shadow model differs from a backtest allowing overlapping positions. Bid/ask execution may also differ from LTP-based backtest fills. Default costs remain estimates; +2 points can be a net loss after costs.
- Pending entries and positions are not guaranteed to close if fresh executable quotes never return. They stay unresolved and visible in the journal, rather than becoming false CLOSED records.
- Python process outages stop the watchdog; durable restart handling mitigates paper accounting only. This is not broker-side protection.
- Same exchange timestamps are conservatively ignored, which may undercount fills from feeds with coarse timestamp precision. Fresh distinct snapshots can still reuse displayed liquidity across times; this is a declared simulation limitation, not a guaranteed fill model.
- The worker uses weekday and contract-date gates, not a full exchange holiday/special-session calendar. The upstream producer must apply the authoritative session calendar.
- Configuration changes are blocked within an existing account scope by a persisted config hash. Do not delete or edit existing evidence to bypass this guard; use an explicitly reviewed versioned strategy scope for a changed experiment.
- PostgreSQL event storage grows with economic/state events. No automatic archive, purge, VACUUM or deletion is introduced. A verified retention policy remains separate work.

Before wiring a production SHADOW producer: run psycopg/advisory-lock integration tests, validate actual signal/feed schema, confirm IV/opposite-contract definitions, observe fresh-input and reconnect behavior, and compare recorded decisions against the fixed backtest rule set. Before any future LIVE work, implement broker fills/cancel-race/ambiguous-submit reconciliation and broker protection separately.

References: https://kite.trade/docs/connect/v3/orders/ and https://kite.trade/docs/connect/v3/market-quotes/

## Double-check regression coverage

The follow-up review added tests for full-fill versus partial-entry VWAP behavior, delayed signal admission, order-creation-based deadlines, pre-exit-request quotes, zero displayed bid depth and conservative recovery-exit sequencing. The core Python suite contains 40 tests; the snapshot-source suite adds 13 tests; the separate PostgreSQL-engine SQL smoke test remains one test.


## Read-only snapshot source/preflight

`snapshot_source.py` reads the existing `option_snapshot_1m` and `market_snapshot_1m` tables in one bounded read-only repeatable-read transaction. It performs no schema or journal writes and does not start an execution engine. `SnapshotSignalSource.produce()` returns the existing bridge's signal-event format plus a compact rejection report. It emits **no depth ticks**, because these stored tables have no displayed bid/ask quantities.

```sh
python -m bnf_shadow.snapshot_source --config bnf_shadow/examples/one_lot.json
```

The command uses the same existing encrypted authority and current instrument master. Its default approved IV-version set is empty. After independently confirming the exact IV units, calculation method and input lineage, a reviewer may explicitly supply `--approved-calculation-version EXACT_VERIFIED_VERSION`; an opaque version string is not itself proof. No production IV version has been approved by this change.

Signal timestamps retain minute-bucket semantics with an exact three-minute bucket baseline. The source requires all four contiguous minute observations on both sides, same strike/expiry, increasing current-side IV, decreasing opposite premium/OI, matching current snapshot IDs with market spot/VWAP, approved calculation lineage, valid row status, in-bucket quote timestamps and fresh current quotes. It never substitutes futures VWAP, reconstructs missing IV, guesses depth, or moves a delayed row to the current clock. Normal bridge/master/strategy qualification still applies.

Read-only Railway inspection on 2026-11-18 observed:

- Recent BANKNIFTY buckets had 78 option rows. Across the observed 11:27–11:31 IST buckets, each bucket's oldest quote timestamp was **2026-11-12 13:59:21 IST**. This does not mean all 78 rows were stale; individual quote freshness must be checked.
- The 11:31 bucket's newest quote was 11:31:10 IST and its first write was approximately 11:31:13.405 IST. The 11:30 bucket's newest quote was 11:30:12 IST and first write approximately 11:30:13.990 IST. Those bucket labels are already older than the unchanged 10-second signal-age limit when first written.
- Nonzero IV and market spot/VWAP were observed. Their presence alone does not verify the IV method or all contract inputs.

**Consequence:** the inspected stored-minute path cannot yet be asserted to meet the current real-time admission deadline. The source fails closed on delayed buckets and old quotes. The preflight code was tested with synthetic fixtures, not run inside production. No production source activation, fresh-depth integration, schema migration, worker launch, merge or deployment was performed by this step. A fresh source with verified IV lineage and real bid/ask quantities is still required before observing end-to-end SHADOW fills. Adjusting strategy freshness policy requires a separately reviewed strategy change; this adapter does not relax it.


## Existing full-depth packet adapter

`depth_source.py` consumes the actual `KiteDecodedPacket` field names from `kite-websocket-binary-decoder.ts`: `instrumentToken`, `exchangeTimestamp`, `lastPrice`, `mode`, `isIndex` and five-level `marketDepth.buy/sell`. The JSONL bridge now accepts `type: kite_depth` with `tradingsymbol`, `receive_ts`, `packet`, and a separately timestamped `market_context` (`symbol`, `spot_ltp`, `vwap`, `spot_ts`, `vwap_ts`). The market context must refer to BANKNIFTY and meet the existing five-second freshness bound at receipt and consumption. A new receipt timestamp cannot make an old market context valid.

Only full non-index option packets matching the current master are accepted. The adapter takes the actual first bid/ask price and displayed quantity, never total book quantity, last-trade quantity or configured lot size. It validates all five levels, order/quantity types, sorting, crossed books and aware timestamps. Missing/invalid depth is rejected. A zero best-level quantity remains zero, even if deeper levels display liquidity. Duplicate receipt attempts produce a stable content-based event ID. Existing engine timestamp/depth/latency guards remain in force. This converter does not open a WebSocket, call a broker, or write a database.

Validation now includes **64 Python tests** (40 core, 13 snapshot-source, 11 depth-source), including decoded packet -> JSONL bridge -> durable simulated entry fill using a temporary SQLite journal. All packet fixtures are synthetic. UTC timestamps ending in `Z`, as emitted by the TypeScript decoder, are normalized explicitly for Python 3.10 compatibility. The PostgreSQL-engine smoke test remains separate. The existing production WebSocket has not been tapped/piped into this worker; no new production socket/subscription or dashboard-startup hook was introduced. Real-time spot/VWAP evidence, approved IV signal lineage, the stored-minute delay issue, isolated real PostgreSQL ownership testing and live SHADOW observation remain release gates.


## Isolated real PostgreSQL ownership/recovery tests

Six opt-in tests in `test_real_postgres.py` cover independent-session ownership exclusion and release, independent strategy scopes, filled-position recovery on a new connection, duplicate-event transaction rollback, duplicate-signal transaction rollback, and termination of the owner's database session. They create a disposable local PostgreSQL cluster through `pgserver` and connect with real psycopg2. They do not accept/read `DATABASE_URL` and do not connect to Railway. `pgserver` is a test-only optional dependency, not a production worker dependency.

Run on a machine/CI runner that permits local Unix-domain sockets and PostgreSQL child processes:

```sh
python -m pip install psycopg2-binary pgserver==0.1.4
BNF_SHADOW_REAL_PG_TEST=1 python -m unittest bnf_shadow.test_real_postgres -v
```

Without the explicit opt-in, all six tests are skipped. Do not count skipped tests as passed.

Validation attempt in this workspace: PostgreSQL cluster initialization reached socket setup, but the host rejected `socket(AF_UNIX, SOCK_STREAM)` with `PermissionError: [Errno 1] Operation not permitted`. `setUpClass` failed and **zero real PostgreSQL tests executed**. The disposable fixture was cleaned up. This is an execution-environment restriction, not evidence of PostgreSQL correctness or a strategy failure. The previously passed 64 Python tests and one PGlite SQL smoke test remain separate evidence. At the time of this local attempt, the six tests still required an isolated PostgreSQL run; the subsequent CI result is recorded below. No production schema/data/service was touched for this attempt.


The dedicated `BANKNIFTY isolated PostgreSQL` GitHub Actions workflow runs the existing 64 Python tests and these six opt-in PostgreSQL tests on Python 3.10 and 3.12. It is restricted to pull requests targeting `production` with changes in this package or its own workflow; manual dispatch is also supported. It uses read-only repository permissions, no persisted checkout credentials, no production secrets, isolated disposable databases and a ten-minute job timeout. Workflow availability/execution must be checked separately; adding its YAML does not prove a successful run.


Verified CI result: [run 44251212799](https://github.com/bhagirathibarik0282-sudo/optionpilot-pro/actions/runs/44251212799), tested commit `fec0787d019f49034f4929618a56cb0fdd8e2235`, completed successfully. Both Python 3.10 and 3.12 jobs logged `Ran 64 tests ... OK` followed by `Ran 6 tests ... OK` with no skips. All six real PostgreSQL ownership/recovery/rollback tests therefore passed in CI. The independent Permanent Guardrails CI also passed on that commit. This clears the isolated PostgreSQL integration gate, not the remaining production feed/IV/freshness and live SHADOW observation gates. No production database, worker or broker order was involved.


## Existing trading-feed JSONL relay

`feed_relay.ts` provides `installBnfShadowFeedRelay` for an explicitly enabled, same-process observer of the existing trading WebSocket transport. The caller supplies the existing `registerKiteTickObserver` function, a caller-owned SHADOW worker stdin/Writable, a current-master contract lookup and a timestamped BANKNIFTY spot/VWAP lookup. There is no socket creation, child-process spawn, database mutation, credential forwarding or automatic startup in this module.

The binding contract is:

```ts
installBnfShadowFeedRelay({
  enabled: relayExplicitlyEnabled,
  registerObserver: registerKiteTickObserver,
  writer: callerOwnedShadowWorkerStdin,
  contractFor: currentMasterContractForToken,
  contextFor: independentlyVerifiedFreshBankniftySpotVwapForToken,
});
```

These are caller-owned integration inputs, not implicit globals. No production caller has been installed by this change. The dashboard display-only transport retains `broadcastObservers:false`; it is not repurposed as a trading feed. Existing trading-feed observers can be used only in their own process with the corresponding master/context authority. If that feed is disabled, this relay receives nothing; it does not start a substitute connection.

Relay output allowlists packet fields and displayed depth quantities. Missing context, stale/future/naive clocks, wrong contracts and incomplete depth reject without output. Writes are at most 32 KiB per line; a sink already buffering 64 KiB drops incoming packets. `write(false)` counts the accepted line once, drops subsequent input until drain and never queues/replays old quotes. Sink/callback failures detach the observer and expose only a fixed status code. Stop detaches the relay without closing caller-owned stdin. A stalled relay cannot block the dashboard or accumulate an unbounded packet queue; the Python watchdog still owns no-feed handling.

Nine Node tests cover disabled mode, field allowlisting, actual quantities, freshness, context gaps, backpressure, sink failures, cleanup and TypeScript-relay JSONL consumption by the real Python depth converter. The end-to-end relay test uses synthetic packets and no broker connection. Run with Node 24 and the Python dependencies installed:

```sh
node --test bnf_shadow/test_feed_relay.mjs
```

Production activation is still blocked by the unverified fresh spot/VWAP authority, approved IV signal lineage and stored-minute admission delay. No claim of live SHADOW fills is made. Passing relay fixtures cannot resolve those source issues.
