# TigerIQ Android — Independent AI Employee V1

Status: REPO/BUILD/TEST CANDIDATE · PHYSICAL PC01/JOB-001 PENDING

## Purpose
One Android phone is one independent TigerIQ AI Employee. PC01 is the control plane: it activates the Employee/Device, assigns JOBs through Tailscale and receives RESULT/EVIDENCE. The phone performs AI inference itself using a provider credential stored only on that phone.

Canonical runtime:

`PC01 -> Tailscale -> Android JOB -> phone-owned AI API -> Android RESULT/EVIDENCE -> PC01`

The Android V1 runtime MUST NOT forward a JOB prompt to PC01 so PC01 calls the AI provider on its behalf.

## V1 responsibilities

### PC01 / TigerIQ control plane
- issue one-time activation material;
- bind Employee ↔ Device;
- queue and lease JOBs;
- dedupe/idempotency authority;
- accept RESULT/EVIDENCE;
- coordinate review/retry/reassignment.

### Android AI Employee
- keep hardware-backed device identity in Android Keystore;
- keep its own AI provider API credential encrypted on-device;
- pull only JOBs leased to its Employee/Device/Binding;
- call the configured AI provider directly;
- checkpoint attempts/result before submission;
- submit standardized RESULT/EVIDENCE to PC01;
- recover after network loss/reboot without falsely marking work complete.

## AI/provider model
Provider access is not part of Employee identity. `AiProviderConnector` + `LocalAiProviderRegistry` form the provider-neutral boundary.

V1 first connector: Gemini API.
- API key is stored through `SecureSecretStore` backed by Android Keystore AES/GCM.
- Provider/model configuration is local to the phone.
- Direct request target: Google Gemini Generative Language API.
- Provider secret must not appear in activation, JOB, RESULT, evidence, logs or repository source.

Future provider connectors such as OpenRouter/Claude/Groq can implement the same interface without changing the PC01 JOB/RESULT contract.

## PC01 Android endpoints
- `POST /v1/android/sessions`
- `POST /v1/android/jobs/pull`
- `POST /v1/android/jobs/submit`

No `/v1/inference` Android execution dependency is permitted in V1.

## Standard result
A completed phone RESULT includes:
- `jobId`
- `output`
- `provider`
- `model`
- `timestamps`
- `attempts`
- `failover`
- `errors`
- `evidence`
- Employee/Device/Binding identity and completion status.

## Recovery and duplicate protection
- WorkManager periodic wake and reboot/app-update recovery are retained.
- Durable checkpoint stores JOB/result material encrypted locally.
- Lease and binding are validated before execution/submission.
- Provider attempt metadata is sanitized and bounded.
- Once a provider result is persisted, retry resumes submission instead of calling AI again.
- If process death loses volatile lease authority, the phone waits for lease expiry/reacquire instead of forging or reusing authority.

## Frozen from V1 execution
The following legacy mechanisms are not packaged as V1 execution capabilities:
- Accessibility Service;
- overlay/screen control;
- Gemini consumer-app UI automation;
- legacy foreground UI worker;
- package-query automation.

If future JOB classes require Android UI actions, that must be a separately approved capability with its own security/review gate; it is not part of V1 JOB-001.

## Transport
Public cleartext HTTP is rejected. Pilot PC01 may use HTTP only over allowed Tailscale CGNAT address policy; current Android network-security config pins the pilot PC01 address used for the integration candidate. HTTPS remains valid.

## Current acceptance boundary
Repo/CI can prove architecture, unit tests, APK build, manifest/DEX surface and secret-source exclusions. It cannot prove live Gemini credentials, real Tailscale reachability, physical PC01 activation, JOB-001, reboot/network behavior on Samsung hardware, or independent exact-head review without those external systems/devices.

No MAIN/Production release is implied by a passing build.
