#!/usr/bin/env bash
set -euo pipefail
mkdir -p evidence
export ANDROID_USER_HOME="$RUNNER_TEMP/capsule-live-android"
export ANDROID_EMULATOR_HOME="$ANDROID_USER_HOME"
export ANDROID_AVD_HOME="$ANDROID_USER_HOME/avd"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
mkdir -p "$ANDROID_AVD_HOME"
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" "platform-tools" "emulator" "build-tools;35.0.0" "system-images;android-35;google_apis;x86_64"
sudo chmod a+rw /dev/kvm
printf 'no\n' | "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd --force --name capsule-live --path "$ANDROID_AVD_HOME/capsule-live.avd" --package 'system-images;android-35;google_apis;x86_64' --device pixel_2
emulator -avd capsule-live -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader -memory 2048 > evidence/emulator.log 2>&1 &
trap 'timeout 10 adb logcat -d > evidence/logcat.txt || true; timeout 10 adb emu kill || true' EXIT
timeout 180 adb wait-for-device
booted=false
for attempt in $(seq 1 90); do
  if [[ "$(timeout 5 adb shell getprop sys.boot_completed | tr -d '\r')" == '1' ]]; then booted=true; break; fi
  sleep 2
done
[[ "$booted" == true ]]
adb shell wm size 1080x1920
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0
adb shell input keyevent 82
"$ANDROID_HOME/build-tools/35.0.0/apksigner" verify --verbose --print-certs app/app-debug.apk > evidence/signature.txt
timeout 30 adb install app/app-debug.apk
python3 market-capsule-acceptance/live_acceptance.py
