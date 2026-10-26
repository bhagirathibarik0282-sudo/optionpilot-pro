# PR #799 archive lookup proposal — not applied

**Status update:** the actual sampled handler was repaired to 4.88s with code
changes only (wide JSON sort removed from raw SQL; prior reference lookups
scoped once). No live index build was needed or performed. This document is an
optional future scaling proposal, not a release prerequisite. Exact SQL/index
compatibility and predicate parity now pass isolated PostgreSQL CI; actual
source metadata is qualified (12,195 canonical rows, 13,326 markers, no
unexpected/non-string symbols). Live build headroom/impact remain unverified.
See `pr799-archive-root-cause-20261025.json` for the final repair evidence.

The historical 26.18s handler sample motivated this proposal. It does not
authorize or execute an index build, change a query,
promise a latency target, or count browser/mobile acceptance as complete.

## What the actual paired plan proves

Deployment `0634ed3d-aaab-4311-a2fe-eeebedc142c7` explained the exact paired
builder SQL for NIFTY 19 Oct 10:15–11:15 plus 16 Oct 09:15–15:30. It used a
READ ONLY transaction, 5s statement / 1s lock limits, rollback and a 25s process
deadline. EXPLAIN had no ANALYZE; archive SELECTs were not executed.

| Source | Base-table access | Remaining filter |
| --- | --- | --- |
| Markers | `idx_app_state_log_kind_created`, Index Cond = marker kind only | Raw JSON symbol and both source-time windows |
| Canonical | Same existing index, Index Cond = canonical kind only | Decoded symbol and both source-time windows in the lateral Function Scan |

The canonical plan estimates 4,900 source rows. That is a planner estimate, not
an actual row count. Planner cost is not milliseconds. Actual handler timings
come from `pr799-paired-scan-handler-20261025.json`, not from this EXPLAIN.

## Candidate to validate next

A partial expression index on source kind and raw JSON symbol could remove
other-index rows before archive decoding. The review candidate is:

```sql
-- PROPOSAL ONLY. Not a startup migration and not executed.
CREATE INDEX CONCURRENTLY idx_app_state_log_h1_kind_symbol
ON public.app_state_log (kind, (payload->>'symbol'))
WHERE kind IN ('H1_TRUTH_MARKER', 'H1_CANONICAL_MARKET_ARCHIVE');
```

The marker query already has the matching raw-symbol predicate. The canonical
query currently filters `p.symbol`, a field returned by `jsonb_to_record`.
Do not assume PostgreSQL equates that field with the indexed raw expression.
The canonical candidate therefore also needs an explicit base-table predicate:

```sql
-- Proposed additional predicate; retain the existing decoded-symbol guard.
AND app_state_log.payload->>'symbol' = $1
AND p.symbol = $1
```

This is a first-stage symbol lookup. Source date/time remain residual filters,
so it may still scan all historical rows for the selected index. It is not yet
proof of a smooth response. No created_at fence, timestamp substitution,
deduplication, row limit or persistent result cache is proposed. Do not force
a timestamp-expression index by declaring a session-dependent parser immutable.

## Evidence required before a live build

1. Read-only metadata qualification of source symbol types/lengths, source row
   counts and current catalog state. Unexpected large/non-string symbol values
   must be understood before indexing their text representations.
2. In the existing isolated PostgreSQL CI database, prove the proposed predicate
   preserves full canonical multisets, null/malformed-value behavior, both time
   windows and downstream RAG evidence. Confirm index-expression compatibility;
   forced planner settings can prove compatibility, not real-world speed.
3. Verify actual filesystem/volume free space and an explicit reserve for index,
   temporary files, WAL and ordinary database growth. Latest Railway Postgres
   DISK_USAGE_GB was 3.445784576; configured volume size is 5000MB. Those two
   provider observations alone do not prove safe build headroom or index size.
   No index-size or free-space guarantee is being made.
4. Review concurrent-build timing, lock waits, writer/load impact and handling
   of an invalid index after cancellation. The build is outside a transaction;
   read-only diagnostic services must never execute it. A failed build requires
   catalog inspection and a specific reviewed cleanup of this new index only.
5. After an authorized build/query rollout, inspect actual Index Cond, verify
   unchanged selected-evidence fingerprints and measure bounded runtime reads.
   Public edge and Recorder/browser/mobile acceptance still follow separately.

Plan observation, isolated predicate parity/index compatibility and source-key
qualification are complete. Live index size/build headroom and benefit remain
unverified because no live build was performed. The sampled code-only repair
returned the handler in 4.88s. Main application and live database schema remain
unchanged by this proposal; it is not a prerequisite for that code repair.
