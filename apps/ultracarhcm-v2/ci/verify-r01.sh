#!/usr/bin/env bash
# GH-5135 R01 exact Android gate. Never equate the repository web CI with this gate.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
app_dir="$repo_root/apps/ultracarhcm-v2"
test_dir="$repo_root/tests/ultracarhcm-v2"

if [[ ! -f "$app_dir/gradle/wrapper/gradle-wrapper.jar" ]]; then
  echo 'ANDROID_R01_BLOCKED: GRADLE_WRAPPER_JAR_MISSING' >&2
  exit 78
fi
if [[ ! -x "$app_dir/gradlew" ]]; then
  echo 'ANDROID_R01_BLOCKED: GRADLE_WRAPPER_SCRIPT_MISSING' >&2
  exit 78
fi
if [[ -z "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ]]; then
  echo 'ANDROID_R01_BLOCKED: ANDROID_SDK_UNAVAILABLE' >&2
  exit 78
fi

node "$test_dir/r01-preflight.mjs" "$repo_root"
node --test "$test_dir/r01-preflight.test.mjs"
(
  cd "$app_dir"
  ./gradlew --no-daemon :app:assembleDebug :app:lintDebug :app:testDebugUnitTest
)
apk="$app_dir/app/build/outputs/apk/debug/app-debug.apk"
[[ -s "$apk" ]] || { echo 'ANDROID_R01_FAIL: DEBUG_APK_MISSING' >&2; exit 1; }
sha256sum "$apk"
echo 'ANDROID_R01_ASSEMBLE_LINT_UNIT_PASS'
