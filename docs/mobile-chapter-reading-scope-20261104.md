# Mobile chapters and selected stock scope

Status: PARTIAL — local regression checks pass; real Chromium and deployment acceptance pending.

The screenshots expose two independent presentation defects. Fit-page scaling
survived chapter selection on mobile, shrinking a small chapter into desktop-sized
coordinates. The stock table also showed the first five market-wide tracked
quotes beneath a selected-index badge.

At widths up to 600px, the dashboard now opens Market / PCR at scale one.
Selecting any chapter automatically restores reading mode and at least 13px
table text. Wide tables keep their own horizontal scrolling. Mobile zoom buttons
are hidden; All 7 tables retains the overview and returning to a chapter restores
reading mode. Desktop defaults and zoom controls remain available.

The front stock table filters existing source rows through the existing
KEY_STOCKS mapping before taking five. It is labelled a tracked watchlist, with
observed coverage, rather than implying official weighted contributions or full
index membership. Sector / market proxies are explicitly MARKET-WIDE. No new
broker calls, invented weights, data eligibility or trading changes are added.
Missing quotes stay unavailable.

Validation:
- Two new regressions failed against the previous implementation and pass now.
- 43 focused projection, reference terminal, mobile style and source card tests
  pass with no failures or skips.
- Chromium smoke checks every chapter at 360px and 390px, plus desktop layouts,
  and preserves the existing source, PCR provenance and detail-panel checks.
- CI now triggers on screen-overview and its regression test changes.
