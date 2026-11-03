# Recorded replay

DATA → Recorded Replay (above the chapter navigation). Choose the session in Session, expiry & strike settings. Play/Pause, previous/next record, Reset and the IST slider share one cursor across NIFTY, SENSEX and BANKNIFTY. Index/expiry/strike selects pin the premium pair. Initial strike is nearest the spot already observed at the cursor, then stays pinned. Selector inventories use session identity metadata only.

Line Graph uses existing TRUE 3-minute recordings for Spot, qualified full-chain PCR, VIX and the selected exact CE/PE contracts. OI/walls, PDH/PDL, opening sampled 15m H/L and previous-session Fibonacci use the existing market-book calculations. Missing endpoints are unavailable, older records have their timestamps, and lines break across gaps greater than three minutes. Numeric values require the exact cursor timestamp. No broker requests, persistence, synthetic ticks or new candidate authority.

Candle is selectable but explicitly reports **OHLC unavailable**: the replay route contains sampled LTP and cumulative session highs/lows, not verified interval OHLC. It never converts snapshots into invented candle extremes. Actual candle playback requires a separately validated interval-OHLC source; this patch does not add one. PCR remains a line series.

1× is one recorded step per second; 5× and 10× reduce that delay, rather than simulating original wall-clock ticks. Playback pauses at the end, on manual seek/step/reset, on session change, when the replay panel collapses, or when the browser hides. The replay panel is separate from LIVE and the other recorded chapters, which retain their explicitly labeled times.

Before deriving a replay model, all current rows after the cursor are removed; reference history is restricted to earlier IST dates. The replay does not use retrospective ratings, current broker quotes, or cached full-session event responses. Tests cover time cutoff, wrong-session/index/TRUE filtering, seek/back/reset, missing endpoints, timer cleanup/speed, exact identity and gap rendering, and Candle unavailability.

## Unified main-dashboard replay (2026-11-03)

The main DATA DASHBOARD Replay button opens controls in place. Replay dashboard switches the existing recorded consumers to one past-only state. Spot/futures, PCR, premium ladders, research events and memory use the recorder cursor. Ladder and OI controls reuse its timer; opening a chapter cannot seek to the closing snapshot. Live arrivals cannot replace historical readings. Return to Live restores the ordinary source gates.

Choose one saved day, Last 3 days, Last 5 days or All saved days. The existing FULL reader loads one session at a time, through the existing bounded request queue. Playback progresses chronologically and stops on an empty, failed or partial day without silently skipping it. Loading and failed days clear the displayed observations. Pause/return-to-live invalidates automatic continuation after an in-flight day load. No new collector, storage, broker request, order or Telegram path is added.

Unrecorded stock/sector/cash context remains unavailable; current context is not substituted. Older observations retain their source times. Sampled LTP is not interval OHLC. Scope, expiry, strike, side and missing-data rules are unchanged.

Validation: `test/unified-dashboard-replay.test.ts` exercises the actual recorder clock, projected state, chronological multi-day playback, failed day and late-completion cancellation. `scripts/unified-dashboard-replay-smoke.ts` opens the full dashboard in Chromium at 390px and 1440px with explicitly offline test observations. It verifies in-page playback, source table updates, backwards seeking, three-day progression, reset, shared ladder controls, OI chapter cursor preservation and live-disconnection isolation. These checks are not production archive completeness or live-market acceptance.
