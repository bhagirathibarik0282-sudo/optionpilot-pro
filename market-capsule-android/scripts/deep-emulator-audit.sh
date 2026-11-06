#!/usr/bin/env bash
set -euo pipefail
out=app/build/emulator-evidence
./scripts/enforce-offline.sh before-cache
# Synthetic private-cache fixture is in androidTest only, never in the deliverable APK.
adb shell run-as com.marketcapsule.app mkdir -p files
adb shell "run-as com.marketcapsule.app sh -c 'cat > files/last-market-snapshot.json'" < app/src/androidTest/assets/audit-cache.json
adb shell am force-stop com.marketcapsule.app
adb shell am start -W -n com.marketcapsule.app/.MainActivity > "$out/cache-first-launch.txt"
sleep 2
adb shell pidof com.marketcapsule.app > "$out/cache-first-pid.txt"
adb shell am force-stop com.marketcapsule.app
adb shell am start -W -n com.marketcapsule.app/.MainActivity > "$out/cache-restart-launch.txt"
sleep 2
adb shell pidof com.marketcapsule.app > "$out/cache-restart-pid.txt"
./scripts/enforce-offline.sh cache-restart
adb shell uiautomator dump /sdcard/capsule-cache.xml
adb pull /sdcard/capsule-cache.xml "$out/cache-restart.xml"
python3 - <<'PY'
from pathlib import Path
import xml.etree.ElementTree as E
p=Path('app/build/emulator-evidence')
assert p.joinpath('cache-first-pid.txt').read_text().strip()!=p.joinpath('cache-restart-pid.txt').read_text().strip()
x=E.parse(p/'cache-restart.xml');text=' '.join(t.get('text','') for t in x.iter())
assert 'SAVED READING AVAILABLE IN MEMORY' in text or 'SAVED — NOT LIVE' in text,text
assert 'RECENT STREAM SNAPSHOT' not in text and 'RECENT SNAPSHOT — NOT A CONTINUOUS STREAM' not in text
print('Actual process force-stop/relaunch restored a historical synthetic cache, not current data.')
PY
adb exec-out screencap -p > "$out/cache-restart-SYNTHETIC.png"
# Clean data before normal UI/large-font captures; no synthetic prices are delivered as live.
adb shell pm clear com.marketcapsule.app
adb shell settings put system font_scale 1.5
./scripts/enforce-offline.sh large-font
adb shell am start -W -n com.marketcapsule.app/.MainActivity > "$out/large-font-launch.txt"
sleep 2
adb exec-out screencap -p > "$out/large-font-top.png"
for attempt in $(seq 1 5); do
  adb shell input swipe 540 1450 540 650 350
  adb shell uiautomator dump /sdcard/capsule-large-font.xml
  adb pull /sdcard/capsule-large-font.xml "$out/large-font-controls.xml"
  if python3 - <<'PY'
import xml.etree.ElementTree as E
x=E.parse('app/build/emulator-evidence/large-font-controls.xml')
text=' '.join(t.get('text','') for t in x.iter())
assert 'Start updates' in text
PY
  then break; fi
done
python3 - <<'PY'
import xml.etree.ElementTree as E
x=E.parse('app/build/emulator-evidence/large-font-controls.xml')
text=' '.join(t.get('text','') for t in x.iter())
assert all(s in text for s in ['Start updates','Today','Live Desk','Memory','Project']),text
PY
adb exec-out screencap -p > "$out/large-font-controls.png"
adb shell settings put system font_scale 1.0
adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation 1
./scripts/enforce-offline.sh landscape
adb shell am force-stop com.marketcapsule.app
adb shell am start -W -n com.marketcapsule.app/.MainActivity > "$out/landscape-launch.txt"
sleep 2
adb shell uiautomator dump /sdcard/capsule-landscape.xml
adb pull /sdcard/capsule-landscape.xml "$out/landscape.xml"
adb exec-out screencap -p > "$out/landscape.png"
python3 - <<'PY'
import struct,xml.etree.ElementTree as E
from pathlib import Path
p=Path('app/build/emulator-evidence/landscape.png');w,h=struct.unpack('>II',p.read_bytes()[16:24]);assert w>h,(w,h)
x=E.parse('app/build/emulator-evidence/landscape.xml');text=' '.join(t.get('text','') for t in x.iter())
assert all(s in text for s in ['Today','Live Desk','Memory','Project']),text
print('Large-font controls reachable after scroll; landscape navigation present:',w,h)
PY
adb shell settings put system user_rotation 0
adb shell pm clear com.marketcapsule.app
