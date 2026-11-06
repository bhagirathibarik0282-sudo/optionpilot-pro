#!/usr/bin/env bash
set -euo pipefail
mkdir -p app/build/emulator-evidence "$RUNNER_TEMP/capsule-original-013" "$RUNNER_TEMP/capsule-original-012"
signer="$ANDROID_HOME/build-tools/35.0.0/apksigner"
analyzer="$ANDROID_HOME/cmdline-tools/latest/bin/apkanalyzer"
if [[ "${DEEP_APK_AUDIT:-false}" == true ]]; then
gh run download 42148706936 --repo "$GITHUB_REPOSITORY" --name market-capsule-test-apk-68ea29b4dd482e39b1510fd844fcfc62a7ab20cd --dir "$RUNNER_TEMP/capsule-original-013"
gh run download 42146441214 --repo "$GITHUB_REPOSITORY" --name market-capsule-test-apk-e4defc4bf5ea4c1f5837b6320c876cd7552c8774 --dir "$RUNNER_TEMP/capsule-original-012"
printf '%s  %s\n' 'ebf69c1fb8ba6d5692e3ed8b2c3d147ed1612da2380cfbaea4fd0fa72aad59c3' "$RUNNER_TEMP/capsule-original-013/app-debug.apk" | sha256sum --check --strict
printf '%s  %s\n' 'be4db5cf7322381ef44ff46c3c15d635ccc8232969c2cb524574d14c1a39b4db' "$RUNNER_TEMP/capsule-original-012/app-debug.apk" | sha256sum --check --strict
"$signer" verify --verbose --print-certs "$RUNNER_TEMP/capsule-original-013/app-debug.apk" > app/build/emulator-evidence/original-013-signature.txt
"$signer" verify --verbose --print-certs "$RUNNER_TEMP/capsule-original-012/app-debug.apk" > app/build/emulator-evidence/original-012-signature.txt
"$analyzer" manifest print "$RUNNER_TEMP/capsule-original-013/app-debug.apk" > app/build/emulator-evidence/original-013-manifest.xml
fi
"$signer" verify --verbose --print-certs app/build/outputs/apk/debug/app-debug.apk > app/build/emulator-evidence/corrected-signature.txt
"$analyzer" manifest print app/build/outputs/apk/debug/app-debug.apk > app/build/emulator-evidence/corrected-manifest.xml
python3 - <<'PY'
import xml.etree.ElementTree as E,zipfile,json,re
from pathlib import Path
ns='{http://schemas.android.com/apk/res/android}'
out={}
for stem in [s for s in ['original-013','corrected'] if Path('app/build/emulator-evidence/'+s+'-manifest.xml').exists()]:
 x=E.parse('app/build/emulator-evidence/'+stem+'-manifest.xml').getroot();app=x.find('application')
 permissions=[t.get(ns+'name') for t in x.findall('uses-permission')]
 assert 'android.permission.INTERNET' in permissions
 assert not any(p in permissions for p in ['android.permission.READ_CONTACTS','android.permission.CAMERA','android.permission.ACCESS_FINE_LOCATION','android.permission.READ_SMS'])
 assert app.get(ns+'usesCleartextTraffic')=='false' and app.get(ns+'allowBackup')=='false'
 out[stem]={'package':x.get('package'),'version':x.get(ns+'versionName'),'debuggable':app.get(ns+'debuggable'),'permissions':permissions,
  'exported':[{'kind':t.tag,'name':t.get(ns+'name'),'permission':t.get(ns+'permission')} for t in app if t.get(ns+'exported')=='true']}
with zipfile.ZipFile('app/build/outputs/apk/debug/app-debug.apk') as z: assert 'assets/audit-cache.json' not in z.namelist()
def cert(stem):
 s=Path('app/build/emulator-evidence/'+stem+'-signature.txt').read_text()
 return re.search(r'Signer #1 certificate SHA-256 digest: (\S+)',s).group(1)
out['certificates']={s:cert(s) for s in ['original-012','original-013','corrected'] if Path('app/build/emulator-evidence/'+s+'-signature.txt').exists()}
if 'original-012' in out['certificates']:
 out['old_test_builds_have_different_signing_keys']=cert('original-012')!=cert('original-013')
Path('app/build/emulator-evidence/apk-audit.json').write_text(json.dumps(out,indent=2));print(json.dumps(out))
PY
