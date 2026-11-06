# Controlled native updates — 0.1.3 test build

User priority: easy, smooth UI. Existing Railway service, feed and SSE route only.
No backend deployment, new service, broker connection, token or order path.

Start updates is explicit and OFF by default. Manual refresh is disabled while
updates are wanted. The visible activity owns the stream: backgrounding closes
it and clears current values; saved history remains. Foreground return joins
old cancellation before opening one replacement stream. Stop updates stops
retries. Activity recreation uses the retained ViewModel to resume the preference;
process death starts OFF again. No background service or notification loop.

One runtime check precedes each connection attempt. Scheduled closure and 401/403
stop automatic attempts. Network failures/EOF/5xx/startup failures retry with
2/4/8/16/30-second capped backoff plus up to 500 ms jitter; 429 waits at least
30 seconds. Socket reads time out after 12 seconds of silence. The existing
server's 15-minute rotation reconnects through the same path. Wrong MIME type,
malformed/oversize/out-of-order data and clock rejection stop updates explicitly.

The reader is scoped to the existing Hono route's LF/CRLF, UTF-8, complete named
snapshot events. Comments and multiline data are handled. Partial EOF frames
are discarded. Line/frame memory is bounded at 4 MiB and the channel conflates
to the latest complete snapshot, so UI consumers do not accumulate tick history.
It is not a general browser EventSource implementation: Last-Event-ID replay and
server retry fields are not used; the server supplies whole current snapshots.
Source runtime/sequence/time ordering survives disconnects independently of what
is displayed. Each frame gets delivery-age/identity checks off the UI thread.
Per-frame delivery is an estimate from phone/server times, not a measured wire
RTT or the age of the entire stream connection. Local cache checkpoints are at
most once per 10 seconds during streaming; Memory always shows its dated saved
observation and a restart can show the older checkpoint. No event history/replay
is reconstructed from conflated frames.

Tests: unit framing, fragmented HTTP transport, cancellation, auth/MIME errors,
partial EOF and capped retry; Android fake-source controller tests for lifecycle,
reconnect, preserved ordering, no overlapping collectors and auth stop; native
UI toggle/manual-refresh gating. Test fixtures remain in test sources only.
These checks do not certify an actual production SSE session, broker continuity,
measured data latency, physical-phone smoothness or recovery through device
network/Doze. Current NIFTY/SENSEX production acceptance remains pending while
the observed runtime is outside its window.

Protocol reference: https://html.spec.whatwg.org/multipage/server-sent-events.html

## Accepted test evidence — 6 November 2026

Source 68ea29b4dd482e39b1510fd844fcfc62a7ab20cd, full workflow 42148706936
SUCCESS. 23 JVM tests (15 prior + 8 framing/transport/policy cases) and 12
Android 15 tests (8 UI/activity + 4 fake-source lifecycle/controller cases)
passed, with zero failures/errors/skips. The new tests cover pending-call
cancellation, fragmented LF/CRLF events, auth/type errors, partial EOF, capped
retry, control gating, background/resume, nonoverlapping fake collectors,
simulated disconnect recovery and ordering preserved through reconnect.
Lint: zero errors, 13 warnings (toolchain/dependency freshness, extraction
rules, missing icon and target API). This is not release certification.
APK/evidence digests matched GitHub; APK archive/manifest/DEX checked and native
offline screenshot visually inspected. The am-start emulator cold-launch result
was 3419 ms; it is not phone startup, frame-rate or live-data latency evidence.
A repeated direct production runtime check still returned outside operating
hours, so a real current quote/SSE session remains pending. No override used.
