# Isolated archived Recorder preview

Status: implemented and locally tested; not started or deployed. Actual browser
click-through, mobile visual acceptance and public-edge latency remain unverified.
The existing Railway diagnostic service remains idle. This change adds no
production route or import in the application startup.

`scripts/pr799-recorder-preview.ts` is a separate manual entry point. It requires
`PR799_PREVIEW=NIFTY_OCT19_1045_READ_ONLY`, `DATABASE_URL` and a private
`PR799_PREVIEW_PASSWORD` of at least 32 characters. It performs one bounded
read-only archive capture through the actual paired RAG reader, verifies the
known selected-evidence SHA256 and evidence admission, then closes the database
pool before binding **127.0.0.1:8789 only**. It does not print credentials, source
rows or a credential-bearing URL. HTTP Basic credentials use username `preview`.
There is no public hostname/domain setup or remote bind option in this runner.

The authenticated preview expires after ten minutes and closes its listener.
Requests cannot query the database. They can only inspect that captured sample.
The route allows the fixed NIFTY / 2026-10-19 / expiry 2026-10-19 / 23150 PE /
10:45 selection. Wrong selections, extra or duplicate query parameters are
rejected. Matching inputs still pass through the original evidence-admission
route. POST and all non-GET methods are rejected; other app routes are absent.
No broker or Telegram credentials are needed; the full app and its background
jobs are never started.

The page uses the actual Recorder markup, installer, scoping function and market
book derivation. It shows a bounded archived window with a fixed contract, not a
complete Recorder session or live dashboard. Changing other controls is allowed
for inspection, but only the fixed PE selection can open the evidence route.
All three index panels remain the existing Recorder UI; absent indices are
unavailable. The original ladder renderer and truth/freshness guards remain
unchanged. This is a frozen acceptance capture, not a production response cache.

Locally verified: authentication on every page, method/path restrictions,
ten-minute maximum expiry, exact query restrictions, original fail-closed evidence
admission, snapshot ownership, escaped embedded data and CSP nonce. A VM test
executes the real serialized Recorder code: no automatic navigation, explicit
click navigates with the exact identity, and changing to missing CE disables it.
These tests are synthetic fixtures and are **not browser or actual-DB acceptance**.
CI runs the five preview tests alongside the existing context-ladder suite.

Manual local preparation command (with the required environment already supplied
privately): `node --import tsx scripts/pr799-recorder-preview.ts`.
Do not expose this loopback listener or change browser origin restrictions as a
workaround for an unavailable browser surface. An actual permitted browser
environment is still needed to complete visual acceptance.
