# Market agreement categories — 18 October 2026

Status: implementation tested locally; production and visual proof NOT_PROVEN.

The Combined context chapter becomes Market agreement with six separate buttons:
Summary; Stocks ↔ sectors; Indices ↔ futures; Premium ↔ DTE;
OI / PCR / walls; VIX ↔ premium. Only category-relevant controls are shown.
The Stocks + sectors chapter reuses the participation comparison directly.
Rows show same direction, opposite direction, flat, time mismatch or data incomplete.
These are descriptive signs, not independent votes, causal explanations or candidate scores.

Comparison rows use recorded observations and are visibly labelled RECORDED.
Matching intraday baseline and observation timestamps, the exact selected interval,
same trading date and as-of cutoff are required. Futures expiry continuity remains
unverified and cannot pass. PCR coverage remains qualified by the existing model;
no full-chain coverage claim is added. PCR/OI/VIX/DTE rows remain context.
Premium comparisons require the same index, strike and side, distinct expiry
identities and nonnegative recorded DTE. Missing data never becomes zero.

Participation reuses existing stored SERVER_BACKGROUND_KITE_QUOTES rows. A bounded,
parameterized, indexed SELECT returns at most 256 snapshots from the selected IST day;
truncation is explicit. The new endpoint exposes whitelisted market fields only.
Invalid dates are rejected and unavailable storage returns 503; responses are no-store.
Saved reads do not require broker login. Collection still needs the existing valid Kite
session. No new broker requests, scheduler, database or persistence stream is added.
The existing collector additively preserves sector price and previous close for future
recordings; legacy sector rows cannot be reconstructed into intraday returns.
Day comparisons retain each instrument's own previous-close basis. Intraday 3/6/15/30m
comparisons require source endpoints within 30 seconds of the requested duration,
source times within 30 seconds of their receipts and paired quotes within 30 seconds.
Only the latest endpoint is bounded to six minutes behind the selected recorded as-of;
older same-session baselines remain available for 15/30m windows.
Duplicate receipts and duplicate selected quote names are excluded.
Four common NIFTY/SENSEX stocks are not counted as independent confirmations.
Sector proxies are selectable comparisons, not asserted membership or weighted contributions.

Devil Check corrections during resume:
- Fixed index selector referencing a render-local variable outside its scope.
- Allowed a changed date to supersede an outstanding quote request, guarding late replies.
- Removed the six-minute cutoff from baseline inventory; it applies to the endpoint only.

Validation:
- Exact Business Dashboard V1 workflow command: 210/210 PASS.
- Full npm test: PASS. Wiring-generated server/Telegram changes restored, excluded from PR.
- Permanent guardrails and git diff --check: PASS.
- Browser serialization/navigation tests exercise actual generated scripts and category controls.
- Actual browser screenshots, production live movement and database readback: NOT_PROVEN.

No candidate authority, buyer Telegram, broker orders, seller execution, configuration,
manual deployment or merge is part of this change. Existing live workspaces remain separate.
