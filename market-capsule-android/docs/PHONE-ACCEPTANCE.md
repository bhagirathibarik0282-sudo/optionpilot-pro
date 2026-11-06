# First APK acceptance — local opening and one data slice

A successful CI build is not real-phone acceptance. Record phone model, Android version, app version and exact source commit for every observation. No live orders or broker/admin secrets are needed for these tests.

| Test | Required behavior | Result |
|---|---|---|
| First launch in airplane mode | Native navigation opens; no fabricated prices, endless spinner or webpage dependency | Pending |
| Online refresh during runtime window | Correct NIFTY identity, source/server times and qualified recent snapshot, or a clear specific error | Pending |
| NIFTY → SENSEX switch | No value from the old index under the new label | Pending |
| Saved reading after restart offline | Saved observation is explicitly dated and not labelled live | Pending |
| Runtime closed | Explain scheduled closure and keep native navigation available | Pending |
| Server 401/403 | Explain mobile authentication is required; do not ask for broker/admin secrets | Pending |
| Repeated refresh taps | One active request; no queue growth | Pending |
| Stale response/source | Remove recent status and withhold current values; saved view remains explicitly historical | Pending |
| Background then foreground | No continuous hidden age timer; age reconciles on return | Pending |
| Activity recreation | Selected bottom tab restored; all values remain qualified | Pending |
| Font scale/portrait/landscape | Controls readable and reachable without clipping; no scroll jump | Pending |

Measure separately: usable local-screen opening, first qualified fresh reading, response time, refresh error, and UI responsiveness. A rapidly rendered saved reading is not proof of low market-data latency.

Current scope is manual snapshots only. Continuous streaming, broker/mobile login, full ladders, full capsules/RAG and notifications are later milestones. The user prioritizes easy and smooth UI above decorative animation or feature count.
