# UltraCar — GitHub-owned parameterized TEST APK verifier and signer

This is a NEW script in the repository, not a modification of the existing `D:\TigerIQ\Tools\sign_latest.ps1`.

Use an authorized, clean Git worktree for `git pull --ff-only`. Do not pull in a dirty or detached checkout, or where another updater owns the resource. Do not edit a `.ps1` directly on PC01.

Local existing v65 verification (no build, no signing, no Drive writes):

```powershell
powershell.exe -NoProfile -NonInteractive -File .\apps\ultracarhcm-v1\release\Invoke-UltraCarTestApk.ps1 -Version v65 -VersionCode 306 -Mode VerifyOnly -ExpectedSha256 FA7FB76F9E9FF034E66FC134DEEE65690E2C9BCBB8D37C9E15C08BE8F1F7132B
```

Only for a newly aligned TEST APK with exact matching metadata/hash, no signed output, and pre-existing locally protected signing environment variables `TIGERIQ_ULTRACAR_KS_PASS` and `TIGERIQ_ULTRACAR_KEY_PASS`:

```powershell
powershell.exe -NoProfile -NonInteractive -File .\apps\ultracarhcm-v1\release\Invoke-UltraCarTestApk.ps1 -Version v66 -VersionCode 307 -Mode Sign -AlignedSha256 ACTUAL_64_CHAR_ALIGNED_SHA
```

Never put passwords in GitHub or command arguments. If these variables are absent, signing stops before attempting to modify output. No new credentials should be introduced solely for this trial.

Signing is never allowed to replace an existing file, including v65. Source build and Drive synchronization are separate stages, and local PASS never means Drive or DeX QA PASS.
