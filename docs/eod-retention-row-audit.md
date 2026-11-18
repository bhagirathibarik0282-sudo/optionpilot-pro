# Read-only EOD row audit

This manual command compares one existing EOD_ARCHIVE_V2 JSON file with source rows in one consistent, read-only database snapshot. It adds no scheduled job and changes no retention settings, Google Drive authentication, schema, archive, or application behavior. Existing retention deletion remains blocked.

After PostgreSQL has recovered and has working disk space, use a byte-preserving download of an existing EOD archive from the established Drive integration:

```sh
node scripts/eod-retention-row-audit.mjs --date 2026-11-16 --archive /secure/path/optionpilot-eod-2026-11-16.json
```

The command reads DATABASE_URL using pg's standard connection/TLS configuration. Prefer a SELECT-only database role. It does not print credentials, source rows, or driver error messages. It does not upload or download Drive files, authenticate a new account, or change existing Drive scopes. Gzip copies are accepted; the receipt is compared with the SHA-256 of the original decompressed JSON bytes, including whitespace. Do not reformat the downloaded JSON.

## What is checked

- All current EOD categories, including chain/timeframe/trade records and research memories. Research memories come from selected app_state_log kinds and payload.tradeDate, not a presumed research_memory table.
- Snapshot rows use minute_bucket's IST date. Other groups use their actual EOD date fields. UTC timezone is fixed for server JSON serialization; differing timestamp text formats may conservatively report a content mismatch.
- Full-row categories compare unique archive IDs with typed database IDs, plus exact PostgreSQL JSONB row content. Added, missing and changed rows are reported separately. Equal counts alone cannot pass.
- Narrative and participation archives contain payloads without database row IDs. Nonempty groups report PAYLOAD_ONLY_NO_ROW_IDENTITY even when counts match. Older archives may omit participation only when the source count is zero.
- Original local file checksum, historical DRIVE_VERIFIED receipt, Drive file ID presence and receipt count must agree. This is not fresh verification that the file remains downloadable from Drive.
- Required tables, archive categories, valid dates, safe JSON integer range and duplicate IDs are checked. Absent source tables fail rather than silently skip.

Output is JSON. safeToDelete and deletionAuthorized are always false. SNAPSHOT_MATCH_ONLY is a limited comparison result, never permission to purge or a full restore proof. INCOMPLETE_OR_MISMATCHED exits 2; AUDIT_BLOCKED exits 1. --apply and EOD_RETENTION_APPLY=true are rejected before opening a database connection.

## Operational limits

There is no DELETE, VACUUM, DDL, upload, automatic cleanup or retention-policy change. This audit cannot repair disk-full recovery or reclaim disk space. PostgreSQL read-only transactions prohibit application table changes but do not guarantee zero physical disk writes: https://www.postgresql.org/docs/current/sql-set-transaction.html

One connection, one date, 250 archive rows per comparison batch, a 45-second server statement timeout, a 2-second lock timeout and a 50-second client query timeout bound individual operations. There is no total job time guarantee. The compressed and decompressed files are capped at 128 MiB; JSON parsing can require several times that amount in RAM. This is bounded file processing, not constant-memory streaming. It does not load the duplicate payload from eod_archive_payloads.

The comparison holds a consistent snapshot while querying. Source rows can change after completion, so future deletion requires fresh byte verification and row-content revalidation in its own protected transaction. No deletion implementation is supplied. EOD archives cover selected categories, not users, schema, sequences, all app_state_log kinds or the entire PostgreSQL volume.

## Validation

Run the regular dependency-free tests:

```sh
node --test test/eod-retention-row-audit.test.mjs
```

An optional in-memory PostgreSQL engine integration test covers IST midnight boundaries, memory tradeDate versus created_at, changed contents with the same count, late-added rows, removed rows, payload-only groups, missing legacy participation and read-only write rejection. It never uses DATABASE_URL. In a disposable checkout, install its optional test-only dependency without changing the project manifest/lockfile:

```sh
npm install --no-save --package-lock=false @electric-sql/pglite
EOD_ROW_AUDIT_SQL_TEST=true node --test test/eod-retention-row-audit.test.mjs
```

A successful test run uses synthetic local data. It is not a live Railway or Drive reconciliation.
