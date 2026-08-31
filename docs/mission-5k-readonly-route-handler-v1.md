# Mission 5K — Startup Recovery Read-Only Route Handler V1

Scope: standalone GET-only route handler contract above Mission 5J observability response.

Safety invariants:
- fixed path `/api/shadow/startup-recovery`
- GET only
- read-only and diagnostic-only
- no logging/startup/route side effects
- no automatic new-entry replay
- no broker order authorization or placement
- fail closed on wrong method/path/input invariant
- no server.ts wiring
- no Railway/config changes
- no main merge
- no production deployment
