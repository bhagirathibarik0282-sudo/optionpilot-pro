# First Recorder matching rule — proposal only

Status: accepted for the first research-validation step following the user's
continuation instruction after double-check. The exact rule is declared in
`audits/recorder-match-rule-v1-20261026.json` at its actual timestamp. It is not
active or connected to the dashboard. No historical percentage or profitable-trade
claim is produced. The proposal below records its scope and limitations.

The first proposed endpoint research question is: among earlier Recorder
sessions matching the selected option context, how often did that exact
historical contract's premium increase by at least 10% after exactly 15 minutes?

Proposed matching inputs use only currently implemented/admitted features:
same index, option side, calendar DTE, event minute and relative moneyness sign;
same exact three-minute premium-change direction and spot position versus PDC.
Each historical episode keeps its own fixed expiry, strike and side. These
coarse matching conditions do not imply a complete market-pattern match.

Proposed minimum support is five distinct matched prior sessions, with every
selected outcome present and a complete nontruncated successful source scope.
This is an initial research support floor, not proof of forecast reliability.
Fewer than five stays unavailable; do not lower the floor after seeing outcomes.
The existing loader accepts at most 20 recorded dates in an explicit history
range and 64 contracts per session. Matching the same calendar DTE may leave
too few eligible sessions even when that scope is fully loaded.

The declaration uses the actual timestamp, not an earlier event time. Do not backdate
it to make old targets eligible. Prospective targets must become known at/after
that declaration; earlier sessions may supply their historical matches. Old
targets may be used for source/transport diagnostics, but cannot be represented
as targets that passed this predeclaration guard.

This proposal does not match PDH/PDL crossings, O=H, PCR, walls, sectors or
multi-DTE alignment: those features are not implemented in this matching core.
It is not a target-before-stop trade-win rate. Any later eligible display must
say historical matched endpoint outcome rate and show rule, horizon, numerator,
denominator, uncertainty and evidence provenance. RAG similarity is never a
probability input.

Before enabling any number: agree/declare the rule, validate the existing
bounded loader against actual Recorder history, inspect coverage/rejections,
then complete guarded UI and browser acceptance. No new database/schema,
probability activation, service deployment or background query is authorized or
performed by writing this proposal.
