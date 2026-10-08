# OptionPilot remaining mission chain — 9 October 2026 IST

## Verified production baseline

PR 630 merged at 622dde4b098eb4e5096e51463cf0db705ec69a9f. App deployment 7b4a83e8-fe6f-4ab4-9018-f317b02a6956 and existing Postgres online. Intraday readback for 8 October: 470 events, 1,111 qualified responses, 299 missing, no pending slots. CAS readback: 51 stored summaries, 84 qualified pairs; next run 9 October 15:35 IST. FII/DII cash context readiness: 8 October, 20 stored sessions, readback ready. Participant context independently latest verified 7 October.

## Ordered gates

1. AUTH BLOCKED: EOD cron failed 8 October with invalid_grant. Main app Drive status also reports Token refresh failed. User reauthorization is required at /api/drive/connect. That callback saves an encrypted volume session; EOD cron separately reads GOOGLE_REFRESH_TOKEN. Reconnecting the main app alone does NOT establish cron recovery. Secure propagation/reuse and an actual cron upload must be verified; never request a token in chat.
2. PATCH PREPARED: EOD V2 includes only CAS, intraday events, responses and session receipts from app_state_log, selected by payload.tradeDate (recovered data may be inserted later). Original row metadata preserved. V1 receipts do not qualify for V2 duplicate skipping; an authorized retry can produce a new checksum version without deleting old Drive files. Count and payload SQL use the same scope. Drive acceptance additionally downloads bytes and checks SHA-256 and byte count, including reused files.
3. ARCHIVE READBACK PENDING: no actual V2 production upload has occurred. Existing database payloads, Drive metadata and a green deployment are not full archive acceptance.
4. RETENTION BLOCKED: APPLY remains rejected by PR 626. This patch grants no deletion authority and does not prove that every currently deletable source row has an exact restorable copy. The legacy cleanup_allowed metadata is not sufficient. Auth, outcome/trade journals and research memory must remain protected. Current default retention is 60 calendar days, not an implemented nine-trading-session policy.
5. SHUTDOWN PENDING: no shutdown configured. Verify recorder completion, 15:35 CAS/memory finalization, 16:00 EOD cron completion and database availability before proposing a bounded shutdown/wakeup change. Do not interrupt current recording or assume Railway app sleeping also stops PostgreSQL billing. Holiday/session calendar and Monday wakeup require explicit validation.
6. CONTEXT PENDING: FII/DII capture already works; audit existing dashboard display before adding integration. Manual GIFT remains a separate timestamped context input, without trading authority.
7. LIVE PROOF PENDING: actual 9 October recorder cycles must persist new events and exact +3/+15/+30-minute responses. Historic recovered records cannot count as forward-live proof.

## Validation and limits

Local full npm test passed before generated runtime files were restored. Focused archive, retention, CAS and intraday suite: 56 passed. New readback tests reject corrupted bytes, HTTP 403 and wrong sizes despite matching metadata. PostgreSQL memory/export receipt test requires an isolated EOD_ARCHIVE_TEST_DATABASE_URL and is skipped locally; CI service is configured to execute it. No production credentials were printed or changed, no cleanup or shutdown performed. Code is a review proposal; merge/deploy requires review and production-change approval.
