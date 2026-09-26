# TigerIQ Android Worker — MVP Contract

Status: SOURCE SKELETON / NOT YET REAL-DEVICE VERIFIED

## Purpose
One Android device can act as one persistent TigerIQ employee workstation. The Android app does not own company hierarchy or business decisions. It is an execution runtime that receives bounded Task Packets from TigerIQ Control Plane and returns structured Result/Evidence.

## Required components
- `WorkerIdentity`: employeeId + nodeId + paired Control Plane identity.
- `ForegroundWorkerService`: persistent heartbeat/task-poll loop subject to Android background limits.
- `TaskInbox`: accepts only schema-valid signed/authorized Task Packets.
- `ExecutionRouter`: dispatches to allowed adapters (Accessibility, browser, approved provider app adapter, local utility).
- `AccessibilityBridge`: semantic UI discovery/actions; coordinate-only macros are fallback diagnostics, not primary automation.
- `EvidenceCollector`: screenshots/log metadata/task timestamps; secrets and unrelated user content must be redacted/excluded.
- `Watchdog`: bounded timeout, app restart/recovery and failure classification.
- `ResultPublisher`: returns structured result; never reports DONE without required artifacts.

## Secure pairing
1. Control Plane creates one short-lived pairing challenge for a new node.
2. Worker generates a device-local keypair in Android Keystore when available.
3. Worker submits public key + challenge + node metadata.
4. Control Plane binds `nodeId` to that public key and returns a scoped node credential/token.
5. Long-lived private key never leaves device storage.
6. Node credentials are revocable and scoped to register/heartbeat/task/result operations only.
7. AI account passwords, Gmail passwords, provider tokens and Owner private profile are never uploaded into repository or task evidence.

## Heartbeat
Recommended interval while active: 15-60 seconds, adaptive to battery/thermal state.

Worker reports only operational metadata required for scheduling:
- nodeId, app version, Android version/model class;
- online/degraded state;
- battery percentage and optional thermal state;
- allowed capabilities and installed adapter availability;
- active task count;
- last task outcome category.

## Task execution states
`RECEIVED -> VALIDATED -> RUNNING -> RESULT_READY -> ACKNOWLEDGED`

Failure states are explicit, e.g.:
- `NETWORK_UNAVAILABLE`
- `APP_NOT_INSTALLED`
- `LOGIN_REQUIRED`
- `UI_CHANGED`
- `ACCESSIBILITY_DISABLED`
- `PROVIDER_LIMIT`
- `TIMEOUT`
- `DEVICE_THERMAL`
- `POLICY_DENIED`

The Control Plane decides whether a failure is retriable/reassignable.

## Device-control layers
1. Worker APK + Accessibility Service for autonomous semantic interaction where appropriate.
2. Farm Gateway through ADB/Appium/UiAutomator2 for inventory, fallback control, restart, screen capture and legacy-device support.
3. scrcpy for human diagnostics only; not a task protocol dependency.

## AI/provider adapters
A phone employee may have a fixed provider/account setup, but provider access is an adapter capability rather than the employee identity. API/local model adapters are preferred where available. Consumer-app automation must be provider-specific and enabled only when allowed by the applicable technical/account policy.

## Real-device acceptance gate
No Android execution claim is valid until two physical phones prove:
1. pairing and heartbeat;
2. two different tasks received concurrently;
3. task execution without Owner touching each phone;
4. structured result + screenshot/evidence returned;
5. one independent reviewer worker evaluates combined evidence;
6. disconnect/restart produces bounded recovery rather than duplicate execution.
