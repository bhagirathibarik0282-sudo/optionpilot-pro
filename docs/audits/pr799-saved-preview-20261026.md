# Saved Recorder preview preparation — 26 October 2026

`scripts/pr799-saved-recorder-preview.ts` reuses the successful fixed capture
without database access, Railway changes or full application startup. The raw
capture remains outside the repository. The runner requires the existing manual
preview flag, private password and `PR799_CAPTURE_TRANSPORT_FILE` path. It verifies
the original decompressed transport SHA256 before parsing, the read-only flags,
selected-evidence fingerprint and original ladder admission. Compressed input and
decompression output are bounded. Existing authentication, exact selection,
GET-only routes, loopback binding and ten-minute expiration are retained.

Validation: the actual saved capture started the loopback preview successfully;
missing configuration and a modified manifest both exited without starting it.
All eleven existing capture/preview tests passed. The listener was stopped and
its port verified closed. No database query or production change occurred.

Actual browser/mobile acceptance is still pending. Automatic browser approval
review denied opening localhost because the private Recorder sample would be
transmitted to the cloud browser without explicit disclosure authorization. No
alternate browser, public endpoint, tunnel or indirect workaround was attempted.
The user must explicitly authorize that fixed sample for the cloud browser before
another attempt; such authorization does not guarantee that origin access will
be available. VM and in-process checks remain distinct from visual acceptance.
