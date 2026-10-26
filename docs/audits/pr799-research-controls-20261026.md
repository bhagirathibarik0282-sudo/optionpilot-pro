# Research Recorder controls — 26 October 2026

The Research destination now exposes a compact Recorder Data strip before the
command card. Open Data expands the existing Tools / recorded-replay drawer;
Session / Index / Expiry expands the existing settings drawer. Both scroll to
their target and focus its summary when supported. No controls or IDs are
duplicated. The strip appears only within Research and refreshes its recorded
session label when the existing state changes, including on the same page.

These buttons do not load a session or start playback automatically. The existing
Recorder and settings retain authority over selection, loading and replay. No new
fetch, source, timer, database operation or numerical probability is introduced.
Mobile CSS wraps the controls with a minimum 44px button height.

Validation: 166 local tests passed across one-stop navigation, Recorder replay,
premium workspace, recorded premium workspace, market-book models, live chapter
projection, strike comparison and reading guides. The existing serialized
navigation test now checks the two actions, session-date refresh and Research-only
visibility. Patch whitespace check passed. These are local code/VM checks, not
browser/mobile visual acceptance. Main remains undeployed by this change.

This is the Recorder entry-control step toward the supplied reference. The full
combined seven-section Research layout and actual matching-history validation
remain unfinished. Historical matching probability is still disabled.
