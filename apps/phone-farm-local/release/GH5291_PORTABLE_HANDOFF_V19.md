# GH-5291 — TigerIQ Phone Farm v1.9 portable handoff

Status: prerelease product handoff only. This is not F04/F09/F10 runtime acceptance and not a production release.

## Exact source

- Main SHA: `0e0528a382d8199d4faca79a680d6c3da8e05bb6`
- PR: #5586 — Parse official adb mdns service columns
- Build run: https://github.com/newsdayads/tigeriq-ai-lab/actions/runs/41427164490
- Actions artifact ID: `13132905561`
- Artifact name: `TigerIQ-PhoneFarm-Windows`
- Actions artifact expiry: `2026-11-16T10:15:40Z`

## Verified portable package

- File: `TigerIQ-PhoneFarm-Windows-v1.9.0-portable-main-0e0528a3.zip`
- SHA-256: `e245d610f3218c95c6433a7636fcb95130001ad4d28d571546b59a57e4328baf`
- Size: `104093979` bytes
- Outer GitHub Actions artifact digest: `sha256:c128588f40988411296741abffc6bbb2a7ef1a991121076d7286b1f4fd88d199`

## Build manifest readback

- Schema: `TIGERIQ_PHONE_FARM_BUILD_V1`
- `sourceHead`: `0e0528a382d8199d4faca79a680d6c3da8e05bb6`
- `localOnly`: `true`
- `TigerIQPhoneFarm.exe` SHA-256: `9A0EDE593DA2D2289C13A99532D2E11140BE349E90C9401AD7337662437CEE3B`
- Node: `24.19.0`
- .NET SDK: `8.0.427`
- WebView2: `1.0.4258.31`

## Verification result

Downloaded artifact readback passed:

- EXE hash matches `BUILD_MANIFEST.json`
- official whitespace-separated `adb mdns services` parser is present
- compact mDNS fallback remains present
- `adb tcpip` is absent
- `setprop service.adb.tcp.port` is absent
- bundled self-tests: `34 PASS / 0 FAIL`

Use `windows/verify-portable-v19.ps1` to verify a downloaded ZIP before use.

## Durable bootstrapper prerelease

https://github.com/newsdayads/tigeriq-ai-lab/releases/tag/tigeriq-phone-farm-bootstrapper-v1-0e0528a3

Bootstrapper SHA-256:
`88be7a7324d44f3f1a4ac0f02f441c608d9d5403d92377a08dc937e8e17828dc`

## Acceptance boundary

Current runtime acceptance remains `9/12`.

Open:
- F04 — WiFi ADB runtime acceptance
- F09 — LAN control runtime acceptance
- F10 — physical offline acceptance

Do not mark DONE or production from this handoff.
