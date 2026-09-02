# TigerIQ V1 — Android Independent AI Employee

Status: IN_PROGRESS — REPO/BUILD/TEST ONLY; PHYSICAL PC01 E2E PENDING
Branch: `wo-v1/android-independent-ai-employee`
Base lineage: PR #132 exact `21bbb09875a171d5b6003a188e70230c4e87b6d2`

## Owner-approved architecture

PC01 is the control plane and operating-data authority. Each Android phone is an independent AI employee.

Runtime path:

`PC01 -> Tailscale -> Android JOB -> phone-owned AI provider API -> Android RESULT/EVIDENCE -> Tailscale -> PC01`

The phone MUST NOT forward the prompt to PC01/TigerIQ so PC01 calls the AI provider on the phone's behalf.

## Reused from prior Android work

Keep:
- Android Keystore device identity and hardware-backed proof;
- Employee/Device identity and authoritative binding;
- one-time activation;
- durable checkpoint and encrypted local job/result material;
- lease authority, dedupe/idempotency boundary and bounded retry;
- WorkManager periodic recovery, reboot/app-update recovery and network retry;
- result/evidence submission.

Frozen from execution:
- Accessibility;
- overlay/screen control;
- Gemini-app UI automation;
- legacy foreground UI worker.

## V1 phone-owned AI

Provider connector boundary is `AiProviderConnector` + `LocalAiProviderRegistry`.

First connector: Gemini API.
- Gemini API key is stored only in `SecureSecretStore`, encrypted with Android Keystore AES/GCM.
- Provider/model config is local to the phone.
- Gemini is called directly at `generativelanguage.googleapis.com` with `x-goog-api-key`.
- Provider credential is never included in PC01 activation, JOB, RESULT, evidence or logs.

Future connectors may implement the same interface for OpenRouter/Claude/Groq without changing the PC01 JOB/RESULT contract.

## PC01 Android control contract required for physical integration

Activation bundle `TIQ1.<base64url JSON>`:
- `controller`: PC01 URL (HTTPS, or Tailscale `100.64.0.0/10` HTTP allowed by policy; current Android network config pins `100.97.23.87` for cleartext pilot transport);
- `employeeId`;
- `credentialId`;
- `bootstrapToken` one-time only.

HTTP routes expected from PC01:
- `POST /v1/android/sessions` — short-lived Android control-plane session;
- `POST /v1/android/jobs/pull` — returns `empty` or a device/binding-bound lease + JOB;
- `POST /v1/android/jobs/submit` — accepts the standard RESULT with lease authority and idempotent replay handling.

No `/v1/inference` Android execution dependency remains.

## Standard RESULT payload

Android returns:
- `jobId`;
- `output`;
- `provider`;
- `model`;
- `timestamps`;
- `attempts`;
- `failover`;
- `errors`;
- `evidence`;
- plus Employee/Device/Binding identity and completed status.

Provider-attempt metadata is sanitized and checkpointed across bounded retry. Provider secret is excluded.

## Today's gates

Can prove without physical PC01:
- source architecture gate;
- unit tests;
- debug + unsigned release APK build;
- merged manifest/DEX audit;
- no Accessibility/UI automation packaged;
- no server inference path packaged;
- no hard-coded provider secret;
- stable-signing continuity mechanism with disposable CI identity.

Cannot honestly prove today without physical PC01/phone/provider credential:
- Tailscale reachability;
- real activation/session;
- real JOB-001 pull;
- live Gemini auth/quota/provider result;
- RESULT accepted into PC01/PostgreSQL;
- reboot/network physical recovery;
- Z Flip/Z Fold behavior;
- independent exact-head review.

## JOB-001 physical acceptance for tomorrow

1. Activate one Samsung against PC01 through Tailscale.
2. Configure that phone's Gemini API key locally.
3. PC01 queues JOB-001 with a harmless prompt.
4. Phone pulls JOB-001 and calls Gemini directly.
5. Phone submits standard RESULT/EVIDENCE to PC01.
6. Verify PC01 stores one authoritative completion and rejects duplicate submit safely.
7. Repeat after network interruption/reboot to verify resume/no duplicate.
8. Independent reviewer verifies exact candidate evidence before any release decision.

No MAIN/Production and no paid-service activation in this work order.
