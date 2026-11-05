# REA role in Market Capsule

REA means Reverse Engineer Anything: https://github.com/morluto/rea

## Useful supporting work

- Inspect accessible reference app/site behavior, script/module relationships and browser observations.
- Investigate current web dashboard faults by comparing captures and network/console observations.
- Supply evidence for implementation and regression investigation.

## Boundaries

REA is not the Android application runtime, broker feed, authoritative calculation engine, historical database or RAG store. It does not independently create a production-ready financial app or recover a service's private backend/data merely by inspecting the interface.

Passive CDP inspection is different from action-driving scenario tools. Default network-shape observations do not establish exact response values; use suitable API/capture evidence. The user's previously installed 6.7.0 capabilities and connection are not verified in this session.

Use ordinary source/API tooling first where it directly answers the question. REA is optional and must not block native app development. No REA installation, session connection or capture has been performed in this build stage.
