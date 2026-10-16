# Live UI render budget

Browser control requests timed out while the live page kept receiving packets. The prior view regenerated every card/select and both active charts on each snapshot. Each historical point also constructed new locale formatters, and the reading observer remeasured the live subtree after these DOM writes.

The view now preserves mounted selectors and patches only value, control and chart fragments. HTML writes use a WeakMap of generated source strings, so SVG serialization normalization cannot force an unchanged chart to be rewritten. Changed inventory is mounted after an open selector closes; numeric updates continue while it is open. Disconnect/stall clears live values and invalidates the write cache.

Locale formatters are reused in the live panel and shared chapter strip. Actual incoming chart samples are appended before a 250ms chart-paint budget; numbers, source timestamps and stale/disconnect processing retain their incoming cadence. Identity, interval, layer or reference changes invalidate the relevant chart cache immediately. The existing 600-point cap and missing-data gaps are preserved. No extra timer, subscription, broker request or storage is added.

Explicit live styles are at least 16px; the shared reading observer skips this known subtree and does not schedule empty measurement frames. All other reading decoration remains active.

Local script-only benchmark, one active Spot series with 150+ real fixture samples: mean render 25.71ms before versus 3.01ms after (eight measured updates). This excludes browser parsing/layout and is not a phone latency guarantee. Browser post-rollout acceptance is still required. Regression checks exercise selector identity across ticks/editing, deferred inventory remount, retained sub-250ms samples, chart throttling, disconnect invalidation and reading-observer isolation.

Sampling also follows the collector cycle-start timestamp, with completion/source times kept separate. Measured response latency can make successive completion timestamps less than 60s apart despite correctly spaced minute cycles; using those completion differences could skip a valid 1min sample. The new cycle metadata fixes that without changing broker cadence or freshness rules.
