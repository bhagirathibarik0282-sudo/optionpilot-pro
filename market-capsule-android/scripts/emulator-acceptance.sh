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
adb shell svc wifi disable
adb shell svc data disable
./gradlew --no-daemon :app:connectedDebugAndroidTest --stacktrace
adb shell pm clear com.marketcapsule.app
adb shell am start -W -n com.marketcapsule.app/.MainActivity > app/build/emulator-evidence/cold-launch.txt
sleep 3
adb exec-out screencap -p > app/build/emulator-evidence/offline-launch.png
