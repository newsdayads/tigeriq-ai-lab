# TigerIQ Phone Farm — supply-chain audit RC (2026-10-26)

Scope: the TigerIQ Windows package built from PR #5292. This audit applies to the TigerIQ-authored package, not to the separately downloaded upstream ADB Device Farm evaluation folder.

## Components distributed in the TigerIQ package

| Component | Provenance | Distribution evidence | Security / license state |
| --- | --- | --- | --- |
| TigerIQPhoneFarm.exe | TigerIQ source, .NET 8 WinForms + WebView2 | Built by `windows/package-windows.ps1` and GitHub Actions | Self-built and currently unsigned; verify SHA-256 from `BUILD_MANIFEST.json`. No claim of a commercial code-signing certificate. |
| Node.js 24.19.0 | OpenJS Foundation official Node distribution | `node.exe` copied from the pinned build runtime | PC01 Authenticode: Valid, signer OpenJS Foundation. `NODE_LICENSE.txt` SHA-256: `148EACF7863EF4329224A29398623077200A27194AA075569FAF4A0A85566CA5`. |
| .NET 8 self-contained runtime | Microsoft .NET SDK/runtime | Emitted by `dotnet publish` | `DOTNET_LICENSE.txt` and `DOTNET_THIRD_PARTY.txt` are packaged. |
| Microsoft WebView2 1.0.4258.31 | Microsoft.Web.WebView2 NuGet package | Restored by the pinned csproj package version | PC01 `WebView2Loader.dll` Authenticode: Valid, Microsoft Corporation. LICENSE and NOTICE are packaged. |

## Explicitly not redistributed

The TigerIQ package does **not** include LAIXI binaries, credentials, license services, ADB Device Farm / QtScrcpy binaries, Qt libraries, FFmpeg libraries, `adb.exe`, or `scrcpy.exe`. PC01 uses separately installed, owner-authorized ADB and scrcpy paths. This avoids rebranding or silently redistributing the upstream native evaluation bundle.

PC01 RC bundle inspection found zero filenames beginning with `adb`, `scrcpy`, `Qt`, `avcodec`, `avformat`, `avutil`, `ffmpeg`, `ffprobe`, or `LAIXI`.

## Runtime boundary

The controller server binds `127.0.0.1:8765`. Source and runtime network inspection found no Internet endpoint in the TigerIQ controller; observed Node TCP state was one loopback LISTEN socket and the desktop EXE had no TCP connection. WiFi ADB is restricted in code to RFC1918 IPv4 addresses and non-privileged ports.

## Build and integrity

The GitHub workflow runs syntax/unit tests on Node 22 and builds the Windows package with .NET 8 plus pinned Node 24.19.0. The packaging script emits `BUILD_MANIFEST.json` with source HEAD and SHA-256 values for the TigerIQ EXE, bundled Node, and WebView2Loader.

Unsigned TigerIQ EXE is an explicit limitation, not concealed. Do not bypass Windows Defender or SmartScreen. Integrity is checked using the release SHA-256 and CI provenance until a future TigerIQ code-signing certificate is intentionally procured.

## PC01 audit receipts

- Node 24.19.0: Authenticode Valid, OpenJS Foundation; SHA-256 `3602F2BB1A10F2CBAB4C36886218A33C1AB3DB87290E73B033C46C77147D0237`.
- WebView2Loader 1.0.4258.31: Authenticode Valid, Microsoft Corporation; SHA-256 `3426DCC55FDFB8B5E7AC623CF33B4CCF283FBF68A0C5A65BDDFDB4D749A8ABEE`.
- License/notice hashes are captured in GH-5291 runtime evidence.
