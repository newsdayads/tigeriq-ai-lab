# TigerIQ Phone Farm — Feature parity / native candidate audit (2026-10-24)

## Objective
An independent self-hosted controller for Android boxes/phones on owner PC01, without LAIXI authentication/servers, with no **license-imposed** device count cap. No copying, patching, or bypassing LAIXI binaries. Native candidate: **duarteenc/adb-device-farm v3.0.0**.

## Grounded feature comparison
| LAIXI public feature | ADB Device Farm v3.0.0 claimed capability | Verified on PC01 | Acceptance limit |
|---|---|---|---|
| USB/WiFi detection, hundreds of devices | ADB + LAN discovery, auto reconnect | **1 physical USB Samsung found**, screenshot and realtime tile | Multiple device & WLAN untested |
| Multi-screen, quality/FPS | Qt GPU farm grid, quality presets/sliders | **Real live 1-device feed** and sliders visible | Hardware 20–300 devices untested |
| Mouse/keyboard/broadcast | Small-view control and Control All | Controls present in native UI | Multiple real devices untested |
| Group and naming | Persistent groups and registry | Groups page present | CRUD behaviors untested |
| Batch APK install/upload/download | Batch actions, applications, files | Menus/buttons present | No APK/file mutations made |
| Screenshot and recording | Batch screenshots/recording | **Screenshot 1/1 succeeded**, verified PNG at `C:\Users\wdragons12x\Pictures\ADBDeviceFarm\screenshots\2026-10-24_12-41-45_R3CM400AKRX.png` (2,848,157 bytes) | Recording untested |
| Auto.js scripts / auto tasks | Visual Automation Studio + scheduler | Menus visible; official README documents functions | Auto.js compatibility **not established** |
| Quick scripts/text group | Clipboard/templates & text broadcast | Send text button visible | Cross-app reliability untested |
| LAN/remote/multi-PC | Local device farm, LAN device discovery | No external established TCP connection at inspected instant; only local 127.0.0.1 connections | **Multi-PC remote sharing NOT established**, no internet-disconnect test |
| AI/Claw automation | Optional Ollama local model workflows | Native source documents optional integration | Not configured or tested |

LAIXI reference: https://docs.laixi.app/en/docs/product/%E4%B8%BB%E8%A6%81%E5%8A%9F%E8%83%BD%E4%BB%8B%E7%BB%8D/ and https://docs.laixi.app/en/docs/category/4-%E5%8A%9F%E8%83%BD%E4%BB%8B%E7%BB%8D%E4%B8%8E%E4%BD%BF%E7%94%A8%E6%95%99%E7%A8%8B/ .
Alternative source: https://github.com/duarteenc/adb-device-farm and https://github.com/duarteenc/adb-device-farm/releases/tag/v3.0.0 .
Third-party notice: https://github.com/duarteenc/adb-device-farm/blob/main/docs/THIRD_PARTY.md .

## Source + supply chain
- GitHub release **v3.0.0** published 2026-08-24, repository license Apache-2.0. Dependencies include Qt 6 (LGPL-3.0/GPL/commercial), FFmpeg LGPL-2.1+, scrcpy Apache-2.0, SQLite public domain. Respect license notices and Qt LGPL if repackaging; current test **does not redistribute binaries**.
- Official portable ZIP `ADBDeviceFarm-portable-3.0.0.zip`, size 51,463,061 bytes; SHA-256 provided by GitHub release API = **d99ec17803c893b5e9503e3cbd2f8060a051ecb43e0d0043f3b882b8e2bc0223**.
- PC01 hash **MATCH**, Defender scanned ZIP and extracted folder, zero detections matching release path in Get-MpThreatDetection. `QtScrcpy.exe` **NotSigned**; unsigned, do not claim trusted publisher signature or reproducible-source build.
- No LAIXI source/binaries/credentials used.
- Portable unpacked under `D:\TigerIQ\Apps\TigerIQ-PhoneFarm\upstream-eval\ADBDeviceFarm-portable-3.0.0`; native UI actually running in desktop session 1. Shortcut: `C:\Users\wdragons12x\Desktop\TigerIQ Phone Farm Native.lnk`.
- Screen evidence: `D:\TigerIQ\Apps\TigerIQ-PhoneFarm\upstream-eval\audit-screen.jpg`. UIAutomation evidence: `ui-automation.txt`, `ui-action-evidence.txt`; screenshot success in `data\logs\adb-device-farm.log` on PC01.
- Last observed process established TCP connections were 127.0.0.1 only; app also performs **local LAN scan** 192.168.100.0/24. This does **NOT** establish an absolute offline or privacy guarantee.

## Unresolved release gates
1. No proof of 2+ concurrently connected physical devices, performance at 20/100/300, or script parity.
2. Offline proof by controlled egress isolation not yet done. **Do not disable RDC/network remotely.**
3. Not all claimed feature modules tested. Automated APK install requires user-provided package and safe target.
4. Third-party license files/redistribution compliance of upstream portable should be reviewed before TigerIQ-branded redistribution.
5. The previous Node proof-of-concept at `apps/phone-farm-local` is not a replacement for this high-performance native candidate; both remain separate until source/build strategy accepted.

Verdict: **Native candidate promising and working for single USB phone; total owner target NOT DONE.**
