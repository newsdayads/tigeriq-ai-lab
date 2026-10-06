# TigerIQ Android Worker — MVP Contract

Status: #2949 GATE C CORE ↔ MOBILE EXACTLY-ONCE / v0.20 RELEASE CANDIDATE

## Gate B0 pilot setup

v0.6 turns the earlier probe screen into a guided real-device setup:
- device/node identity is generated automatically;
- Owner selects only the AI provider (ChatGPT or Gemini);
- TigerIQ Core assigns the logical NV id, department and pilot role during pairing;
- the app verifies reachability to PC01 through the canonical private Controller address before pairing;
- Accessibility, Controller, heartbeat and semantic-tree evidence are shown as separate real states;
- no hidden employee/profile fallback is presented as a real assignment.

The semantic probe remains deliberately read-only. It does **not** auto-click, auto-send, or collect conversation text until physical Z Flip evidence supports the next adapter implementation.

Master authority: #2949 / `MOBILE_WORKER_MASTER_V1`.

## Gate B1 ChatGPT Adapter

v0.10 adds a DEV-only semantic ChatGPT adapter after the Z Flip 7 proved the native Accessibility tree:
- one- or ten-cycle harmless confirmation test;
- semantic editable-node detection + `ACTION_SET_TEXT`;
- semantic send-control detection + `ACTION_CLICK`;
- exactly-once guard per cycle;
- WAITING/COMPLETE/ERROR state machine with bounded ChatGPT relaunch recovery;
- terminal evidence reported idempotently to TigerIQ Core;
- no task lease, backlog self-pull, GitHub mutation, coordinate taps or gesture fallback.

v0.12 adds a safety gate and pacing before the same physical acceptance:
- the active run starts in `WAITING_PROJECT`;
- TigerIQ will not type/send until ChatGPT emits a real click on Project `TigerIQ AI Lab`;
- minimum fill-to-send dwell is 3 seconds;
- cooldown between completed cycles is 6 seconds;
- merely seeing the project name is not sufficient; the project item must be clicked in ChatGPT.

Physical acceptance still requires 10 real cycles and at least one ChatGPT restart/recovery on Z Flip 7. This source/build must not be called Gate B PASS until that evidence exists.


## Gate C Core-issued mobile tasks

v0.20 carries the reviewed Gate C Core-job path plus the Update Engine ↔ Core lease mutual-exclusion hardening into the physical release candidate:
- only TigerIQ Core on PC01 may enqueue a mobile task;
- the paired Mobile Worker leases only tasks bound to its node + AI Employee identity;
- lease renewal is bounded and stale/wrong-worker results fail closed;
- one Core runId is persisted across Android process/provider restart recovery;
- terminal result commit is idempotent and conflicting duplicate results are rejected;
- Android still does not scan backlog or write GitHub directly;
- Gate D remains a separate relay proof through Core/Coding Lane.

Gate C runtime acceptance requires 10 real Core-issued jobs on the Z Flip with zero duplicate terminal commits.


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


## Managed update policy

Production fleet updates must use a managed Android channel rather than UI automation around package-install or Play Protect prompts.

- `MANAGED_PLAY`: preferred for Android Enterprise / Managed Google Play private-app rollout.
- `MANAGED_MDM`: equivalent managed-device rollout for an approved MDM, including Samsung enterprise tooling.
- `SELF_INSTALL`: DEV/fallback only. The Worker downloads the signed APK and uses PackageInstaller, which may still require OS or Play Protect confirmation.
- Unknown install modes fail closed.
- The application ID and signing certificate lineage must remain stable across all channels.
- Core heartbeat `agentVersion` is the acceptance source for fleet version convergence; an update is not DONE merely because a release was published.
