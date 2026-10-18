# One-minute observation archive

The scheduler attempts one capture per actual minute during the existing market and closing-observation sessions. It uses the existing Kite authority, market refresh single-flight, normalized market/options/chain tables and canonical H1 archive. No database or provider is added.

Existing three-minute slots retain their business processing. Intermediate minutes use the existing observation-only path, which returns after H1 recording and does not invoke recorder-side candidate marking, journal, shadow outcomes or Telegram. Closing observations use this same path. The in-memory business recorder remains three-minute; its 200-snapshot retention is unchanged.

A capture must finish before another can start. Missed minutes are not backfilled. Deduplication uses an absolute minute slot, including the date. Real source timestamps, existing Truth verdicts and missing values are preserved; one-minute scheduling does not guarantee one-minute source freshness or successful persistence.

Replay continuity expects one-minute buckets from 2026-10-19 onward and keeps three-minute expectations for prior dates. Archived PCR direction compares adjacent one-minute records after that cutover and remains unavailable across gaps. Existing analytical 3/6/15/30-minute windows keep their time durations. Existing playback advances through saved timestamps, so one-minute recordings play without a new replay timer.

Validation: scheduler tests exercise duplicate ticks, skipped minutes, new trading days, slow captures, rejection recovery and business-vs-observation dispatch. Actual capture tests confirm both intermediate and closing paths return before authority callbacks. Replay tests check old/new grids and missing-minute PCR comparisons. Production write/readback remains NOT_PROVEN until deployed and a market session records adjacent minutes. Broker reads and archival writes will increase relative to the three-minute recorder; concurrent refreshes still share existing single-flight protection.
