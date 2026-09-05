# Canonical One-Roof Market Snapshot

Purpose: place all already-produced live market evidence under one snapshot identity without creating a second calculation or candidate authority.

Required families per snapshot:
- market structure
- futures confirmation
- option premiums
- OI/positioning
- multi-DTE
- volatility
- heavyweights
- sector breadth
- response ladder
- liquidity/executability

Rules:
1. A valid snapshot identity is recordable even when strict filtering is not ready.
2. A closed minute is immutable history.
3. Strict Buyer/Seller filtering requires exactly one verified, time-bounded component for every required family.
4. Heavyweights are mandatory confirmation evidence, not candidate authority.
5. Internal quality blockers are retained for audit; user-facing state is action-oriented.
6. This envelope does not calculate direction, rank candidates, send Telegram, create orders, or allow AI override.
