#!/usr/bin/env bash
set -euo pipefail
mkdir -p app/build/emulator-evidence
model=app/src/main/java/com/marketcapsule/app/MarketModel.kt
fixed="$RUNNER_TEMP/capsule-fixed-model.kt"
cp "$model" "$fixed"
trap 'cp "$fixed" "$model"' EXIT
git fetch --no-tags --depth=1 origin 68ea29b4dd482e39b1510fd844fcfc62a7ab20cd
git show 68ea29b4dd482e39b1510fd844fcfc62a7ab20cd:market-capsule-android/app/src/main/java/com/marketcapsule/app/MarketModel.kt > "$model"
set +e
./gradlew --no-daemon :app:testDebugUnitTest --tests com.marketcapsule.app.AuditRegressionTest > app/build/emulator-evidence/original-parser-regression.log 2>&1
result=$?
set -e
cp "$fixed" "$model"
trap - EXIT
[[ "$result" != 0 ]]
cp app/build/test-results/testDebugUnitTest/TEST-com.marketcapsule.app.AuditRegressionTest.xml app/build/emulator-evidence/original-parser-regression.xml
python3 - <<'PY'
import xml.etree.ElementTree as E
x=E.parse('app/build/emulator-evidence/original-parser-regression.xml').getroot()
assert x.attrib['tests']=='6' and x.attrib['failures']=='6' and x.attrib['errors']=='0', x.attrib
print('Original 0.1.3 parser: all 6 targeted audit regressions reproduced as assertion failures; corrected source restored.')
PY
