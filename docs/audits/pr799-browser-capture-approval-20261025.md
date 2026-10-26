# PR799 bounded archive transport for browser acceptance

Latest status, 26 Oct: the third separately approved fixed capture SUCCEEDED at
commit `949a4f7f`, deployment `ecdbbf82-5d73-4c26-9b5c-803106151087`.
Completion sentinel, transport SHA-256, selected-evidence fingerprint and
original/transported projection equality passed. Captured three exact market
markers and three 23150 PE rows, retaining 153.85 / 137.10 / 142.90 at
10:42 / 10:45 / 10:48 IST. In-process Recorder/evidence routes returned 200;
unauthenticated / wrong-contract / POST guards returned 401 / 422 / 405.
No actual browser/mobile acceptance or matched-history probability is claimed.
The diagnostic idle command is restored, restart remains NEVER, no public
endpoint exists, and main is unchanged. See
`docs/audits/pr799-capture-success-20261026.json`; earlier failures remain in
their separate audit records and are not relabelled as successes.

The available browser cannot reach the workspace's loopback preview (observed
ERR_CONNECTION_REFUSED). Proposed next step: transport a fixed archive capture
so the authenticated preview and a Chromium test can run together on one CI
runner. Do not expose the original preview or alter browser origin restrictions.

## Concrete operation requiring approval

- Existing project courteous-perception, production environment, diagnostic
  service pr799-readonly-acceptance (`8db59b5b-25b0-4cd0-b92d-fb584c1a89d4`) only.
- Pin the diagnostic service to the reviewed PR799 capture commit and temporarily
  run `PR799_BROWSER_CAPTURE=NIFTY_OCT19_1045_READ_ONLY node --import tsx scripts/pr799-browser-capture.ts`.
- Use the existing DATABASE_URL reference; do not read, print or transfer its value.
- Execute the existing paired archive reader in verified READ ONLY transactions,
  with 45s statement / 1s lock / 120s process limits and restart policy NEVER.
- After the DB pool closes, emit bounded gzip/base64 transport chunks to this
  diagnostic service's Railway logs. Base64 is transport encoding, NOT encryption.
  These logs will contain selected archived market values and evidence timestamps.
- Include only three exact NIFTY 19 Oct 2026 Recorder markers (10:42, 10:45,
  10:48 IST), expiry 19 Oct / 23150 PE, and allowlisted renderer inputs for the
  existing RAG before/after lanes. Prior-session source reads still occur for
  the existing reader; prior-session raw rows are not exported.
- Check the existing selected-evidence SHA, exact 153.85 / 137.10 / 142.90
  premiums, complete three-marker identity, unchanged projected ladder and
  bounded transport size. Refuse missing/duplicate/non-TRUE rows or changed data.
- Restore the diagnostic start command to its prior idle/no-query marker after
  the one run. Keep no public listener/domain, cron or background retry.

No main service deployment, market-data/schema/index write, broker request,
selector, Telegram or execution change is part of this operation. Later CI
browser execution and actual responsive review must be verified separately;
the capture itself is not browser acceptance or a public-edge latency test.

Automatic approval review rejected both the temporary diagnostic start-command
change and pinned-source deployment because explicit authorization for service
mutation and archived-data logging was missing. Neither operation succeeded.
Do not reroute the operation to evade that decision. Obtain explicit approval
for this bounded operation before running it.

The above rejection describes the earlier attempt to obtain authorization. The
user subsequently approved one capture on 26 Oct; both mutations were accepted.
That first attempt failed as recorded in its audit. At that point no second
capture had been performed; the separately approved second attempt is documented
in the latest status above. Offline
repairs preserve null checkpoints and add safe failure-stage reporting, without
relaxing source identity, fingerprint, size or read-only guards.

## Local verification

Eight tests passed: three new transport/entry-point tests plus five existing
preview guard tests. New tests exercise stripping unknown nested/raw fields,
refusing missing/duplicate/non-TRUE endpoints, wrong contract/price/fingerprint,
failed previous-session reads, and unconfigured startup without payload output.
These are fixture tests, not an actual archive capture or browser pass.
