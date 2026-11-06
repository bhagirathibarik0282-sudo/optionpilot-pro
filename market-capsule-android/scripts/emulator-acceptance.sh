#!/usr/bin/env bash
set -euo pipefail
mkdir -p app/build/emulator-evidence
export ANDROID_USER_HOME="$RUNNER_TEMP/capsule-android"
export ANDROID_EMULATOR_HOME="$ANDROID_USER_HOME"
export ANDROID_AVD_HOME="$ANDROID_USER_HOME/avd"
mkdir -p "$ANDROID_AVD_HOME"
sdkmanager="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
avdmanager="$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
"$sdkmanager" "platform-tools" "emulator" "system-images;android-35;google_apis;x86_64"
sudo chmod a+rw /dev/kvm
printf 'no\n' | "$avdmanager" create avd --force --name capsule-ci --path "$ANDROID_AVD_HOME/capsule-ci.avd" --package 'system-images;android-35;google_apis;x86_64' --device pixel_2
[[ "$("$ANDROID_HOME/emulator/emulator" -list-avds)" == *capsule-ci* ]]
"$ANDROID_HOME/emulator/emulator" -avd capsule-ci -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader -memory 2048 > app/build/emulator-evidence/emulator.log 2>&1 &
trap 'timeout 10 adb logcat -d > app/build/emulator-evidence/logcat.txt || true; timeout 10 adb emu kill || true' EXIT
timeout 180 adb wait-for-device
booted=false
for attempt in $(seq 1 90); do
  if [[ "$(timeout 5 adb shell getprop sys.boot_completed | tr -d '\r')" == '1' ]]; then booted=true; break; fi
  sleep 2
done
[[ "$booted" == true ]]
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0
adb shell input keyevent 82
# Offline by construction: no broker, production endpoint or credentials in this test.
./scripts/enforce-offline.sh before-original
if [[ "${DEEP_APK_AUDIT:-false}" == true ]]; then
# Audit the exact already-delivered 0.1.3 binary before installing corrected tests.
timeout 30 adb install -r "$RUNNER_TEMP/capsule-original-013/app-debug.apk"
adb logcat -c
timeout 30 adb shell am start -W -n com.marketcapsule.app/.MainActivity > app/build/emulator-evidence/original-013-cold-launch.txt
sleep 3
adb exec-out screencap -p > app/build/emulator-evidence/original-013-offline.png
adb logcat -d > app/build/emulator-evidence/original-013-startup-logcat.txt
adb shell am force-stop com.marketcapsule.app
adb uninstall com.marketcapsule.app
adb shell pidof com.marketcapsule.app > app/build/emulator-evidence/original-013-after-stop-pid.txt || true
fi
./gradlew --no-daemon :app:connectedDebugAndroidTest --stacktrace
# connectedDebugAndroidTest removes its installed APKs after the suite.
./scripts/enforce-offline.sh after-instrumentation
timeout 30 adb install -r app/build/outputs/apk/debug/app-debug.apk
if [[ "${DEEP_APK_AUDIT:-false}" == true ]]; then ./scripts/deep-emulator-audit.sh; fi
./scripts/enforce-offline.sh final-launch
timeout 15 adb shell pm clear com.marketcapsule.app
timeout 30 adb shell am start -W -n com.marketcapsule.app/.MainActivity > app/build/emulator-evidence/cold-launch.txt
sleep 3
adb exec-out screencap -p > app/build/emulator-evidence/offline-launch.png
