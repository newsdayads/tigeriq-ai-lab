#!/usr/bin/env bash
# GH-5135 R01: independent source checks first, then fail closed at native Android gate.
# A generic GitHub web CI result is never an Android acceptance receipt.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
app_dir="$repo_root/apps/ultracarhcm-v2"
test_dir="$repo_root/tests/ultracarhcm-v2"

# Run independent regression checks even when the SDK or Gradle Wrapper is unavailable.
node --test "$test_dir/r01-preflight.test.mjs"

# This prints every missing input instead of hiding assets behind the first wrapper error.
if ! node "$test_dir/r01-preflight.mjs" "$repo_root"; then
  echo 'ANDROID_R01_BLOCKED: SOURCE_OR_TOOLCHAIN_INPUTS_MISSING' >&2
  exit 78
fi

if [[ -z "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ]]; then
  echo 'ANDROID_R01_BLOCKED: ANDROID_SDK_UNAVAILABLE' >&2
  exit 78
fi

# Source-control mode bits may differ across GitHub/API writes; invoke official wrapper via bash.
(
  cd "$app_dir"
  bash ./gradlew --no-daemon :app:assembleDebug :app:lintDebug :app:testDebugUnitTest
)
apk="$app_dir/app/build/outputs/apk/debug/app-debug.apk"
[[ -s "$apk" ]] || { echo 'ANDROID_R01_FAIL: DEBUG_APK_MISSING' >&2; exit 1; }
sha256sum "$apk"
echo 'ANDROID_R01_ASSEMBLE_LINT_UNIT_PASS'
