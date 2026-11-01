# UltraCarHCM V2 dev.11 — scoped local TEST signer

Work Order: #5135 - [P1][AUTO][DeXCam] UltraCarHCM V2 — Kế hoạch triển khai xây dựng lại APP gốc

This lane exists only to sign the exact current-main F10 TEST artifact without exposing signing credentials to ChatGPT or broadening the V1 signer task.

## Exact input

- Package: `ai.tigeriq.ultracarhcm.v2`
- Version: `2.0.0-dev.11` / code `11`
- Input: `D:\TigerIQ\Apps\UltraCarHCM_V2\dist\UltraCarHCM_V2_2.0.0_dev11_MAIN_f22c408aa_UNSIGNED_ALIGNED_HANDOFF.apk`
- Pinned input SHA-256: `7562C77C4C3C81A9764179AB55007BA5F25BDAE5E1C9255D5D545BF962F0064C`
- Required signer certificate SHA-256: `71617043EACE89E5F220EA9168B0A9592808111B0F17EAA219F5E6ECEB569558`
- Output: `D:\TigerIQ\Apps\UltraCarHCM_V2\dist\UltraCarHCM_V2_2.0.0_dev11_MAIN_f22c408aa_SIGNED_TEST.apk`

## Boundary

`Sign-UltraCarV2Dev11LocalTask.ps1` reuses the existing current-user DPAPI enrollment under `%LOCALAPPDATA%\TigerIQ\UltraCarSigner`. It does not enroll, print, transmit or persist plaintext passwords. It refuses a different Windows identity, any input SHA drift, package/version mismatch, an existing output, wrong certificate, or failed v2/v3 verification.

The script does not create/edit a Scheduled Task, upload to Drive, install an APK, mutate V1, or release Production.

## Execution gate

Do not repurpose or edit the existing `TigerIQ_UltraCar_v66_Sign_TEST` task. Its authorization is scoped to V1 v66.

After this source is merged and PC01 has that exact source, a separately authorized local-user on-demand task may invoke:

```text
powershell.exe -NoProfile -NonInteractive -File D:\TigerIQ\Workspace\tigeriq-ai-lab\apps\ultracarhcm-v2\release\Sign-UltraCarV2Dev11LocalTask.ps1
```

Task creation or authorization is a separate Windows security action. If the task does not already exist, ChatGPT must not create or widen one after a host/security rejection. Once an authorized task exists, triggering it and verifying the exact signed artifact are separate acceptance steps.

## After signer PASS

Verify exact package/version/certificate/SHA, then use `adb install -r` only against the existing V2 package on the authorized QA device and rerun the bounded F10 durability acceptance. V1 and Production remain untouched.
