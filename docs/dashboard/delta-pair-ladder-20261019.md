# Same Delta ladder pairing

Add Pair by: Same Strike / Same Delta to the ladder for Live and Recorded, with absolute Delta targets 0.25, 0.40 and 0.50. Same Strike remains the default. Pairing is locked out while an exact contract watch is locked.

Same Delta searches all loaded strikes for the selected index, exact expiry and DTE filters. It overrides strike range, side and fixed-strike controls for that view. Each side must be within 0.05 of the target and the difference between absolute CE/PE Delta must be at most 0.02. The nearest total target error wins, then smaller pair gap, then strike order. These are explicit display matching tolerances, not trading thresholds. Display actual signed Delta, individual strikes/premiums/times, target and pair gap. No equal premium or equal return is implied.

Recorded matching requires usable archived rows at the latest bucket in the exact-expiry group and equal observation times. Contradictory same-time Delta duplicates revoke the contract. Missing/invalid/wrong-sign/out-of-range Delta, unverified rows, absent legs and excessive pair differences remain unavailable. Replay filtering prevents future rows from entering the matching input.

The Live option is present and requests both sides across the loaded strike universe, preserving existing complete-ladder and freshness guards. Current Kite WebSocket premium projection supplies no Delta, so Live Same Delta remains unavailable. It does not borrow archived Greeks, calculate synthetic Greeks or claim live matching is proven. Connecting a verified exact-contract live Delta source is separate work.

Validation: 70 focused tests pass, including real serialized UI controls, replay, pin restoration, live request scope, source isolation, mismatched identities/expiry/times and Delta conflicts. Guardrails and diff checks pass. A production archive read for NIFTY 2026-10-16 15:30 returned 90 option rows with numeric Delta and TRUE archive verdicts; this proves field availability in that snapshot, not accuracy of the Greek model or availability of every target pair. Changes are pending deployment; visual/mobile and real live matching proof remain NOT_PROVEN.
