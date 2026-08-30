# OptionPilot Full-Automation Architecture V1

## Goal
Automate the safe engineering loop while keeping production and live trading under a human gate.

## Safety boundaries
- LIVE broker execution: OFF.
- Broker order placement: OFF unless a future separately approved production mission enables it.
- Automatic production deployment from this workflow: OFF.
- Automatic merge to `main`: OFF.
- Any failure or unknown state: fail closed.

## Branch model
1. Feature/mission branches open PRs to `automation-staging`.
2. CI/devil checks run automatically.
3. Eligible green PRs may be auto-merged only into `automation-staging` after the automation gate passes.
4. Promotion from `automation-staging` to `main` remains a human approval step.
5. Railway/production verification happens only after an explicitly approved `main` merge.

## Automation gate
A PR is automation-eligible only when all of the following are true:
- Base branch is `automation-staging`.
- PR is not a draft.
- No production/live-enable marker is present in changed text.
- No direct broker-placement enablement is introduced.
- Existing test suite and targeted CI are green.
- No unresolved review blocker exists.

## Human-gated actions
- Merge or promotion into `main`.
- Any Railway production deploy action.
- Any LIVE broker API/order path.
- Any change that weakens kill switch, idempotency, capital/risk, reconciliation, persistence, or broker authorization controls.

## Failure policy
- CI failure: stop; do not merge.
- Unknown/queued checks: wait; do not merge.
- Safety scanner failure: stop; do not merge.
- Review blocker: stop; do not merge.
- Staging divergence/conflict: stop; require repair before promotion.

## V1 scope
V1 establishes the staging-first automation gate and safety scanner. It does not enable live trading or production deployment.
