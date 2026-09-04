# Current State

Date: 2026-09-04

TigerIQ AI Lab is being operated as a continuous distributed AI company. Tiger IQ Driver (`newsdayads/drivetrack`) remains isolated and unchanged.

## P0 — Dynamic command router / state continuity — #334/#335/#320/#319
Bootstrap 2.2 generic numeric-command resolver has been applied in ChatGPT Project Source.

Current authoritative registry root: GitHub issue #335.
- `1 -> NV-EXEC-01 / Minh — Thực thi trực tiếp / interactive / OWNER_FOREGROUND`.
- `2 -> NV-OPS-01 / Khoa — Vận hành tự động / autonomous / AUTONOMOUS_P0_FIRST`.
- `NV-SYS-01 -> AI PC01 — Kỹ sư Hệ thống Local / pc01-local / active=true / aliases=[]`.
- `3/4/5/...` are currently unregistered. Unknown/disabled/malformed commands must fail closed with `COMMAND_UNREGISTERED`; do not infer semantics from chat history.

Regression / continuity state:
- Genuine NEW CHAT `1`: ĐẠT — resolved from CENTRAL #280 -> Registry Root #335 to `NV-EXEC-01 / Minh / interactive / OWNER_FOREGROUND`.
- Genuine NEW CHAT `2`: ĐẠT — resolved from CENTRAL #280 -> Registry Root #335 to `NV-OPS-01 / Khoa / autonomous / AUTONOMOUS_P0_FIRST`.
- Repeated `1`/`2` messages in the same chat do not count as new NEW CHAT regressions.
- #319 continuity acceptance A/B/C/D/E now has explicit evidence, including a three-NEW-CHAT `2` chain for D. #319 remains open because default-branch `docs/CURRENT_STATE.md` is still stale until this off-MAIN candidate passes its gate and is authorized for integration.
- Remaining #334/#320 acceptance: genuine NEW CHAT `3` while unregistered must fail closed; only then enable test `3` dynamically -> genuine NEW CHAT `3` resolve; disable `3` -> genuine NEW CHAT `3` fail closed; ownership/browser/runtime acceptance remains separate.
- Bootstrap/Project Source must not be replaced for ordinary command/employee/mapping/role/capability changes that remain inside the existing authority envelope.

Ownership contract remains one active owner per Work Order/resource scope. Khoa must SKIP any active foreign lease/resource. Current policy allows Khoa takeover only after the foreign lease is stale beyond policy, with no mutation in-flight, no `OWNER_HOLD`, and a current idempotent checkpoint/evidence trail.

## Owner foreground — Web Control three-layer status / issue #338
- #338 is `OWNER_FOREGROUND` for Minh / `NV-EXEC-01`, with `OWNER_HOLD=true`.
- Claimed resources: `public/index.html`, `public/command-center.html`, `command-center.html`, `tests/pc01-three-layer-status.test.ts` on branch `feat/338-pc01-three-layer-status-v1`.
- Khoa must not mutate those resources.
- Draft PR #339 exact head `e187a2ff1b7c7fcaa21818765da5ba0090ac488b`: repo UI tests ĐẠT, CI #976 ĐẠT, Vercel Verify #385 ĐẠT; still CHỜ independent review/gate and physical E2E.
- Khoa's independent verifier remains isolated in PR #337, one changed file `scripts/verify_work_board_ui.mjs`.
- Draft stacked integration PR #340 proved the #337 verifier compatible with the exact #338 UI head without modifying Minh resources; CI #977 ĐẠT across typecheck, unit tests, Playwright smoke and build.
- No MAIN/Production integration is authorized by this repo-only evidence.

## P0 — PC01 self-operation / issue #318
Current technical parent initiative: #318 `PC01 tự vận hành — bỏ thao tác PowerShell thủ công`.

Current architecture authority:
- `TigerIQ Workforce Controller` = primary PC01 control authority.
- `PC01 Secure Worker` = bounded background executor/command-mailbox worker.
- `OpenClaw` = optional downstream AI/operations worker only; currently `TẠM GÁC` and not a P0 selection target.

### Verified current evidence
- Remote mailbox canaries #321/#323/#324: 3/3 consecutive ĐẠT for `Vy/ChatGPT -> GitHub mailbox -> PC01 claim -> bounded action -> evidence -> auto-close`, without manual PowerShell/restart/port-check work by anh Sơn.
- `TigerIQ Workforce Controller` Scheduled Task is enabled/running as `SYSTEM` with startup/repeating triggers.
- `TigerIQ Worker` and `TigerIQ Worker Watchdog` were observed enabled but logon-only; boot-before-login self-recovery is not yet proven.
- #329 `workforce.controller.status` proved listener `100.97.23.87:8790` with no wildcard/public listener, but HTTP status probe returned `404 Not Found`.
- #330 is the canonical completed read-only Controller diagnostic: `diagnostic_version=3`; Controller entry + `pg` module + database/pgpass/ingress-token files exist and are readable; the expected runner exists, parses, and sets required runtime variables; task is Running as SYSTEM; self-heal result is `FAILED`; ensure-log error class is `DATABASE_URL_MISSING`; listener remains Tailscale-only.
- #333 was closed as a duplicate diagnostic; do not re-create or re-run equivalent work without new evidence.
- PR #314 current exact head `ac43b0aca31f039cdd7ca4b04ade3666ee8d539d`: exact-head CI and technical review evidence exist for the bounded 90s->300s timeout repair, but that is not a genuinely independent approval and does not authorize merge/deploy/runtime activation.
- Draft PR #328 current exact head `7164a643216c2edc09796f86616b82f8153c9d1f`: documents the Secure Worker reboot identity gate and explicitly forbids silently converting Worker/Watchdog to SYSTEM, copying GitHub credentials, enabling auto-logon, or otherwise widening credential scope.
- Physical reboot E2E is not authorized under normal command `2`; explicit Owner authorization is required before reboot.

### Immediate safe continuation
1. Preserve single-worker/idempotency/resource-lock semantics around #318/#282.
2. Do not issue another blind Controller diagnostic or open another PC01 mutation lane: #330/#333 already provide the current bounded diagnostic evidence.
3. #314 remains gated on a genuinely independent approval/authorization path before activation; after activation it still requires runtime acceptance proving model review no longer times out around 90 seconds.
4. #328 keeps reboot/principal/security work behind explicit Owner/security gates.
5. After Controller + Secure Worker path is stable, verify Executor -> independent Reviewer -> Judge and Web Control physical E2E.
6. Keep credential/security boundary changes, MAIN/Production and paid services behind their required gates.

## Auto Worker — issue #306
Issue #306 remains OPEN.

Current field evidence supersedes the V10.2 summary:
- V10.0/V10.1 produced mixed-state UI/runtime ownership; V10.2 then motivated a clean-unified architecture rather than additional overlays.
- Current candidate family is V11 unified worker platform: restore the proven clean V9.8 outer lifecycle/recovery/VERIFY watchdog core, remove V10.x competing overlays/state machines, and expose one canonical Khoa / `NV-OPS-01` runtime state/UI controller.
- V11.0.0 physical installer attempt was rejected and rolled back at `POST_FREE_VERIFYKEY_PRESENT`; no V11.0.0 deployment was accepted. Root cause was a false-positive installer gate scanning human-readable popup/version-history text for a historical executable token.
- Current corrective candidate is **V11.0.1**. Its safety gate checks executable runtime pattern only, while preserving clean V9.8 restore, transactional safety backup/rollback, unified counter/UI/state, Pause/Safe Stop/Emergency Stop semantics, stable node identity, silent notifications and outer recovery/VERIFY watchdog.
- Local validation for V11.0.1: runtime syntax ĐẠT, popup syntax ĐẠT, installer payload syntax ĐẠT, no executable free verify-key pattern, no `chrome.notifications.create`.
- Do not claim HOÀN TẤT until physical Chrome install/reload confirms one canonical V11.0.1 UI/state and runtime regression proves counter `1/6 -> 2/6 -> ...`, 3–8s post-response dispatch without duplicate send, stop modes, unexpected-window recovery, tail watchdog and ownership acceptance A–M.

## OpenClaw — deferred
OpenClaw 2026.9.1 had a verified working online path using `openai/gpt-5.6-sol`, loopback Control UI and TigerIQ policy/skill behavior. Historical evidence remains in `docs/evidence/OPENCLAW-PC01-HANDOFF-2026-09-04.md`.

That lane is intentionally `TẠM GÁC` by the newer #318/#319 authority. Do not continue local fallback benchmarking, gateway-owner migration or Ollama/OpenClaw mutation under command `1`/`2` until a newer explicit Owner decision reactivates it.

## Web Control / physical E2E
- #322 Web Control repo-only preparation exists off-MAIN and must remain subordinate to current P0 gates. Repo-only CI evidence is not physical E2E proof.
- #261 remains the canonical physical acceptance tracker for real queue/state -> Web Control E2E; it is not itself a broad executable job.
- #337 fixes the stale legacy UI verifier; #340 proves integration compatibility with the current #338 branch at repo level.
- UI/evidence must show employee/owner/scope and `SKIP/TAKEOVER/OWNER_HOLD` reason only from authoritative registry/state, not invented activity.

## Current MAIN baseline
- Repository: `newsdayads/tigeriq-ai-lab`.
- Current observed MAIN head before this off-MAIN state reconciliation: `e17fa4d3101a43dc845e0c497a7d35b9dc7732ff`.
- Production Web Control: `https://tigeriq-ai-lab.vercel.app`.
- Vercel/Production changes remain gated; do not retry/spam rate-limited deployment or pay/upgrade automatically.

## Verified Workforce history
WO-024 through WO-039 established the software foundations for hierarchy, scheduling, task/evidence contracts, idempotency/retry, persistent state, scoped credentials, Android pairing/worker, Controller API, Command Center, signing/release preparation and simulator evidence. These historical software results are not proof of current physical PC01/device runtime unless re-verified against the active head/artifact.

## External/deferred boundaries
- PC01/Tailscale/live Controller state must be re-verified; repository/CI is not runtime proof.
- Protected PC01 services must not be restarted/reconfigured merely to make another lane pass.
- No provider/owner/signing secret may enter source control or issue evidence.
- No MAIN/Production, paid service, credential/security-boundary mutation or irreversible action without the applicable authorization/gate.
