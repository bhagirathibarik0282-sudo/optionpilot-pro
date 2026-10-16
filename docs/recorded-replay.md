# Recorded replay

DATA → Recorded Replay (above the chapter navigation). Choose the session in Session, expiry & strike settings. Play/Pause, previous/next record, Reset and the IST slider share one cursor across NIFTY, SENSEX and BANKNIFTY. Index/expiry/strike selects pin the premium pair. Initial strike is nearest the spot already observed at the cursor, then stays pinned. Selector inventories use session identity metadata only.

Line Graph uses existing TRUE 3-minute recordings for Spot, qualified full-chain PCR, VIX and the selected exact CE/PE contracts. OI/walls, PDH/PDL, opening sampled 15m H/L and previous-session Fibonacci use the existing market-book calculations. Missing endpoints are unavailable, older records have their timestamps, and lines break across gaps greater than three minutes. Numeric values require the exact cursor timestamp. No broker requests, persistence, synthetic ticks or new candidate authority.

Candle is selectable but explicitly reports **OHLC unavailable**: the replay route contains sampled LTP and cumulative session highs/lows, not verified interval OHLC. It never converts snapshots into invented candle extremes. Actual candle playback requires a separately validated interval-OHLC source; this patch does not add one. PCR remains a line series.

1× is one recorded step per second; 5× and 10× reduce that delay, rather than simulating original wall-clock ticks. Playback pauses at the end, on manual seek/step/reset, on session change, when the replay panel collapses, or when the browser hides. The replay panel is separate from LIVE and the other recorded chapters, which retain their explicitly labeled times.

Before deriving a replay model, all current rows after the cursor are removed; reference history is restricted to earlier IST dates. The replay does not use retrospective ratings, current broker quotes, or cached full-session event responses. Tests cover time cutoff, wrong-session/index/TRUE filtering, seek/back/reset, missing endpoints, timer cleanup/speed, exact identity and gap rendering, and Candle unavailability.
