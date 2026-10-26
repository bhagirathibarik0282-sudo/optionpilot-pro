# Reference image: compact navigation, first implementation

Reference: user-supplied `1000182938.png` on 26 Oct 2026. Treat all numbers,
expiry dates, directions, RAG matches and probability in that image as illustrative,
not actual market evidence.

This change replaces four workspace groups and the desktop sidebar with the
six top-level destinations shown in the reference. Existing view IDs, loaders,
Kite stream, source/truth/freshness gates and recorded contract identities remain
the data path. No new request, timer, DB or market-data calculation is added.

| Navigation | Existing views |
| --- | --- |
| Research | Overview, Notable changes, Market agreement |
| Ladder | Option chain, Premium comparison, Four expiries |
| Futures & Spot | Futures, Spot + pivots |
| PCR & Flow | OI + walls, Spot + full PCR, India VIX |
| Sector & Weight | Sectors + stocks, FII / DII |
| Memory & Replay | Recorded ladder, Notable changes, FII / DII |

The ladder and memory destinations share existing views while retaining their
independent live/recorded selection. Previous/next navigation wraps across all
six destinations; every original subview remains reachable. Desktop navigation
uses six columns; widths up to 900px use two rows of three 44px touch controls.
Content uses the width previously reserved for the 240px sidebar.

This is the navigation/density step, not a completed pixel match or a combined
seven-table Research page. The remaining design needs include the compact
research overview, parameter controls, combined level tables, participation
presentation and evidence-qualified RAG context. Do not invent weights, point
contributions, full-chain ratios, similar-event dates or an 82% probability to
fill those panels. Preserve explicit unavailable/qualified states.

Validation: 73 relevant tests passed across one-stop routing, one-shot data
cards, chapter rendering and live source qualification. They include all six
destinations, navigation wraparound, remembered subviews, exact live/recorded
ladder routing, script parsing, disconnect revocation and unmodified sources.
These are automated fixture/VM tests, not browser screenshots or real mobile
acceptance. The actual archive-capture approval remains outstanding; no
diagnostic runtime change, main merge or production deployment occurred.

## Mandatory probability provenance — user instruction, 26 Oct 2026

Probability must come strictly from matching historical Recorder data and its
observed outcomes. An LLM confidence, RAG similarity/embedding score, visual
resemblance, screenshot number or live-market opinion cannot supply a probability.

- Define and version the matching rule before measuring outcomes: index,
  selected parameters, PCR scope/provenance, expiry/DTE treatment, option identity
  treatment, event-time cutoff, outcome direction/threshold and horizon.
- Match only features actually available by each event's known-at timestamp.
  Keep the current event and future sessions out of its historical comparison
  set. Do not select historical cases using their later outcomes.
- Preserve each episode's fixed-contract journey and exact recorded timestamps.
  Verify relevant event/outcome observations and provenance. Treat missing or
  conflicting observations as unavailable; do not interpolate outcomes.
- Count distinct eligible episodes. Deduplicate overlapping samples from the
  same event according to a declared rule; do not inflate support with every tick.
- Calculate the unweighted historical matched outcome rate as recorded qualifying
  outcomes divided by eligible completed matched episodes. Show the actual
  numerator/denominator, time horizon, matching-rule version, source dates and
  supporting Recorder event IDs. Report excluded/pending/missing counts too.
- Keep similarity and outcome frequency separate in the interface. Label the
  frequency as a historical matched outcome rate; do not imply a calibrated
  forecast, guaranteed profit or model-generated certainty.
- Set minimum independent support and outcome-coverage criteria explicitly
  before enabling a numeric display. Show uncertainty using a declared method.
  Until these criteria and the retrieval/outcome pipeline are validated, show
  `Probability unavailable — insufficient verified Recorder matches`.
- Use RAG/LLMs only to retrieve or explain inspectable evidence; perform matching
  admission, counting and rate calculation deterministically. No new database,
  broker request, Telegram message or execution authority is authorized here.

Current #799 functionality projects one selected snapshot; it does not retrieve
historical matching events or calculate an outcome probability. This section is
a binding requirement for the future probability card, not a claim that the
matching pipeline or numerical probability is already implemented.
