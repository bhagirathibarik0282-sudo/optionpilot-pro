# Candidate Evidence Live Adapter V1

Purpose: convert verified live observations into the five independent Candidate Evidence Shadow V1 families without changing selector, verdict, execution, Telegram trade alerts, or order creation.

Guardrails:
- Read-only only.
- Unverified/unavailable evidence contributes zero points.
- Neutral positioning contributes zero directional points.
- No selector override.
- No execution impact.
- No order creation.
- BANKNIFTY remains observation/support only at the business-policy layer.
- Runtime wiring is intentionally not included in this adapter PR; it must be added separately at an inspected live-cycle insertion point with production proof.
