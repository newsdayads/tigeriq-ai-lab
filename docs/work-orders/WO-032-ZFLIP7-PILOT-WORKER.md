# WO-032 — Z Flip 7 Pilot Worker

Priority: P0
Status: IMPLEMENTING
Date: 2026-08-31

## Objective
Turn one Samsung Z Flip 7 into the first physical TigerIQ employee workstation using a fixed Gemini account, while keeping physical claims evidence-gated.

## Pilot employee default
- Employee ID: `EMP-001`
- Department: `Research`
- Role: `Researcher`
- Primary AI: `Gemini`
- Device: Samsung Z Flip 7

The values are editable on-device and stored locally as non-secret profile metadata.

## Implemented pilot onboarding
- Human-readable employee onboarding screen instead of a developer-only runtime screen.
- Device-local employee profile: employee ID, department, role and primary AI/provider.
- One-tap Accessibility settings entry.
- One-tap Gemini launch with app/package detection fallback to the Gemini web app.
- Worker status screen: device identity, foreground runtime, Accessibility enabled state, Controller pairing state, and last foreground package observed by the Accessibility bridge.
- Accessibility pilot telemetry records only foreground package and timestamp. It does not read prompt/output text and does not perform third-party UI actions.
- Existing Android Keystore device identity and encrypted scoped Controller credential storage remain intact.
- Pilot app version `0.2.0-pilot` / versionCode `2`.

## Gate
- Android Worker APK build PASS on exact head.
- Repository CI / Queue Hygiene / Vercel Verify PASS where applicable.
- APK artifact must be downloadable and SHA-256 recorded.
- Real-device install on one Z Flip 7.
- Owner grants Accessibility once and logs the fixed Google/Gemini account into Gemini.
- Worker screen must show `Accessibility: ON`, `Worker runtime: ACTIVE`, and observe Gemini/Google as the foreground package after `Mở Gemini`.
- No claim of autonomous Gemini prompting/result extraction until a separate provider-specific adapter is implemented and real-device-tested.

## Next gate after onboarding
Connect the device to an authorized TigerIQ Controller path, pair the node, emit heartbeat, lease one harmless task, and return structured evidence. Only after that gate passes should the Gemini UI/API execution adapter be activated for autonomous work.

## Safety / non-claims
- No password, Google token, Gemini credential or Owner private profile is stored in source control.
- Consumer Gemini UI automation is not enabled by this Work Order.
- Google account remains fixed to this employee device; TigerIQ does not create or rotate accounts.
- No physical-device PASS is claimed until real-device evidence exists.
