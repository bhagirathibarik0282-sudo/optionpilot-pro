#!/usr/bin/env bash
set -euo pipefail
audit_stage="${1:-state}"
audit_network_file="app/build/emulator-evidence/offline-network-$audit_stage.txt"
adb shell cmd connectivity airplane-mode enable
adb shell svc wifi disable
adb shell svc data disable
for attempt in $(seq 1 20); do
  adb shell dumpsys connectivity > "$audit_network_file"
  if python3 - "$audit_network_file" <<'PY'
import re,sys
from pathlib import Path
s=Path(sys.argv[1]).read_text()
assert re.search(r'Active default network:\s*(?:none|null)',s,re.I), 'Default network is not yet absent'
PY
  then exit 0; fi
  sleep 1
done
exit 1
