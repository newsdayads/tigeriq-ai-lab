# WO-040 — Gemini Provider Policy Gate

Date: 2026-08-31
Status: ACTIVE / SOFTWARE GATE

## Goal
Add a narrow, fail-closed policy boundary for the future `gemini-android-ui` adapter without claiming or performing live Gemini automation.

## Scope
- Allow only bounded `research.prompt` tasks.
- Require concrete prerequisites before a real-device provider test may start: verified physical PC01 Controller, real device pairing, fresh authenticated heartbeat, stable-signed Worker continuity, Accessibility enabled, existing provider session, and explicit provider-automation authorization.
- Reject login/2FA paths for unattended execution.
- Reject payment, billing, credential mutation, or provider-account changes.
- Mirror the readiness gate in the Android Worker without adding third-party UI actions.

## Non-claims
This work does not prove PC01/Tailscale is live, does not prove EMP-001 is paired, does not prove a stable-signed APK is installed, and does not execute or prove any Gemini prompt/result automation. `READY_FOR_REAL_DEVICE_PROVIDER_TEST` means eligibility only.

## Deterministic gates
1. TypeScript policy unit tests PASS.
2. Repository typecheck/test/build PASS.
3. Android Worker build PASS.
4. Queue Hygiene PASS.
5. Applicable Vercel Verify PASS without manually triggering or retrying deployments while the Hobby quota condition is active.
6. Exact-head gates must pass before merge.

## Physical gate after merge
Only after canonical issue #100 produces real Controller evidence and EMP-001 has real pairing/heartbeat/stable-signing evidence may a narrowly scoped Gemini adapter be tested on-device. Login/2FA remains owner-controlled and provider restrictions must be respected.
