# Recorded Research participation sections — 26 October 2026

Research now includes section 4, selected-index tracked stocks, and section 5,
shared NIFTY sector and broader-market proxies. A manual button reuses the
existing bounded saved-quote-history reader and handler. No new query, broker
refresh, automatic request, timer, database table or startup path is added.

The view uses only the selected date's loaded history, not the unrelated latest
stock/sector snapshot. It admits the latest unique receipt at/before the selected
spot endpoint and within six minutes. Every numeric quote requires same-session
exchange time at/before its receipt and at most 30 seconds old, positive finite
price/previous close and unique name/symbol in that collection. Unusable rows
retain explicit missing/ambiguous status without numeric values or change rank.
Day return is calculated from the admitted price and previous close, ordered
descending. It is not a replay-window return or official weight rank.

Official index weights and index contribution are unavailable in this source;
both columns stay unavailable even if arbitrary incoming fields claim values.
Sector/broader-market proxies do not imply selected-index membership or weights.
Receipt, quote time, loading/error and truncated-history status remain explicit.
No numerical probability, causal or trade claim is added.

Validation: 178 local tests passed across the related dashboard, Recorder,
premium and background-quote suites. New serialized-script fixtures exercise
manual loading with zero initial requests, exact history URL, positive/negative
returns, escaping, future/old receipt exclusion, stale quotes, duplicate rows and
withheld supplied weight/contribution fields. Whitespace check passed.

These are synthetic fixtures and code/VM checks. Actual saved stock/sector
history and browser/mobile visual acceptance remain unverified. No main deploy
occurred. Notable events and matched-history sections are still unfinished.
