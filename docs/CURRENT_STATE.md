# Current State

Date: 2026-09-01

TigerIQ AI Lab is operated as a continuous distributed AI company. Tiger IQ Driver (`newsdayads/drivetrack`) remains isolated and unchanged.

## Current MAIN / Production truth
- Repository: `newsdayads/tigeriq-ai-lab`.
- Audited MAIN head remains `4d73bd923526aa3396a4f436332a9b863c66e172` (WO-042 secure Owner Web Control login).
- WO-040 merged as `69ef75149155c09d4618afef941e54cf02feaf79`.
- WO-041 merged as `d0b085c10a691d7c1dd41a2861253c96f5f85215`.
- WO-042 merged as `4d73bd923526aa3396a4f436332a9b863c66e172`.
- No later Web/APP/Governance/PC01/Multi-AI branch work is claimed live on MAIN/Production without direct runtime evidence and Owner release authorization.
- Fresh GitHub branch evidence reports `main` as `protected:true`, but the branch summary exposes no required status checks (`contexts: []`, `checks: []`). Repository rulesets remain `[]`.
- Therefore global governance issue #113 remains FAIL: protection exists, but PR-only mutation, required checks, bypass behavior, force-push and deletion policy are not yet independently proven sufficient.

## Canonical autonomous operation feed — #138
- Issue #138 is the single canonical `TIGERIQ_AUTONOMY_FEED_V1` status feed.
- It is state-only and is intentionally excluded from cloud auto-work consumption.
- Each autonomous cycle must update Current Action, Execution Channel, Last Progress, Next Action, Blocker and Updated At from real evidence only.

## Governance enforcement work — #113 / PR #118
PR #118 (`wo046/current-state-governance-reconcile`) is the governance implementation branch.
- `.github/workflows/ci.yml` covers PRs plus `push` to `main` and `merge_group`.
- `.github/workflows/governance-independent-review.yml` provides a machine-verifiable exact-head independent-review gate.
- `scripts/verify-independent-review-gate.mjs` requires structured exact-head `TIGERIQ_INDEPENDENT_REVIEW_PASS`, `REVIEW_ROLE: 07`, exact HEAD SHA and typed `EVIDENCE_REF`.
- `docs/governance/MAIN_PROTECTION_V1.md` defines required MAIN protection and bootstrap procedure.
- Exact governance head `5ab2d56e4034bc6de969591935f09b8212671d87` previously had CI `33519950191`, Queue `33519950147`, Vercel Verify `33519950109` and Governance Gate `33519950137` rerun job `99897232937` PASS after review `5079339009`.
- Later state-only heads were intentionally superseded as Web routing continued. This reconciliation records the final reviewed Web head below and therefore requires fresh exact-head governance CI/Queue/Gate + structured 07 review again.
- Global #113 remains fail-closed until live repository Settings independently prove PR-only mutation, required checks, safe bypass, no force-push and no deletion.

## Web Control — PR #117
- Canonical branch: `wo045/web-control-remote-ops`.
- Final reviewed repository head: `4f9014a3392cd9ce98bd2abb138123b6d103357e`.
- Exact-head repository gates PASS: CI `33523361282` (typecheck, unit tests, Playwright smoke, build), Queue Hygiene `33523361514`, Vercel Verify `33523361238`.
- Fresh independent Web routing review `5079682318` is PASS for repository scope / runtime pending.
- Exact-head Vercel commit status remains FAIL with Hobby `build-rate-limit`; no paid upgrade or retry-spam is authorized and no READY deployment is claimed for `4f9014a...`.
- Web Control retains Owner/TigerIQ auth separation, server-only write credential path, canonical Work Order dedupe, server-owned SHA256 evidence reference, independent Reviewer/Judge gates, mobile status UI and bounded autonomous backlog processing.
- Historical #135 is now handled correctly at repository level: the server owns SHA256 `EVIDENCE_REF`; the scheduler allows exactly one migration retry only for the old model-side SHA/cryptographic-hash blocker; generic bounded blockers remain non-retryable and a second matching legacy blocker fails closed. #135 remains open until this logic runs on an exact-head READY runtime.
- Single Door now classifies execution before any cloud model invocation. PC01/Windows/Scheduled Task/Watchdog/Tailscale/Ollama operational status, runtime audit/log, reboot/deploy/connect actions route to `pc01-runtime-required` with `CLOUD_EXECUTOR_ALLOWED=false`. Z Flip/Z Fold/phone/device install/smoke work routes to `device-runtime-required`, also cloud-blocked.
- Routing includes a repository-analysis exception: explicit code/repo/docs/architecture analysis remains cloud-eligible when no hard runtime action is requested. Regression tests cover runtime audit versus repo audit, avoiding wasteful cloud calls without blocking useful repository work.
- Issue #137 is explicitly `pc01-runtime-required`, `PC01_REQUIRED=true`, `CLOUD_EXECUTOR_ALLOWED=false`; its prior cloud attempt correctly failed because hardware/system-state access was unavailable.
- Remaining Web runtime sequence: wait for zero-cost READY deployment whose `githubCommitSha` equals `4f9014a...`; prove physical instruction creates no cloud CLAIM; run #135 migration once; run harmless Single Door canary/status/dedupe/Reviewer/Judge; obtain fresh runtime-aware review.
- MAIN/Production remains unchanged.

## PC01 security — #114 / PR #116
- Canonical branch: `wo045/pc01-autonomy-hardening` on top of `wo011/pc01-remote-exec`.
- Reviewed exact head: `2b941450f541643b9f4b952493dfd2fc612f30f2`.
- CI `33506910934` PASS; WO-045 Secure Worker `33506910959` PASS; fresh independent repository-security review PASS.
- Raw model-controlled shell/argv is absent; AI reads are explicit repository-tracked/AI-created safe paths; protected/local credential surfaces are denied; public evidence excludes raw file content and uses final secret redaction/fail-closed suppression; Executor/Reviewer/Judge require three distinct immutable Ollama digests and identities are rechecked after execution.
- Reviewed secure bootstrap validates Windows, exact branch/SHA, tests, watchdog syntax, Scheduled Task persistence, backups, preflight, Worker restart and watchdog smoke before `PC01_WORKER_SECURE_V3_BOOTSTRAP_PASS`.
- Repository/security scope PASS only. #114 stays open until least-privilege OS execution, live activation, #57 ingress, #58 deterministic CLAIM+RESULT and #100 Controller evidence exist on PC01.

## Android phone-first worker — #108 / PR #109
- Canonical branch: `wo012/android-phone-first-worker`; exact head `2c65ab71c331964a69ca418d4450c10ef3b067c2`; draft/unmerged.
- Gates PASS: CI `33519326741`, Queue `33519326892`, Vercel Verify `33519326831`, Android Worker `33519326746`; review `5079279419` repository/code PASS.
- Local task history is bounded to 12 terminal records with started/finished times; Home displays five newest.
- Gemini extraction uses privacy-safe pre-submit SHA-256 hashes + completion-marker count, current-prompt anchor, baseline exclusion, newer marker requirement and bounded result evidence; raw prior chat is not persisted and restart without boundary fails closed.
- Regressions cover prior chat, stale marker, duplicate events/text, missing prompt anchor, restart, login, provider limit, timeout and response evidence threshold.
- Physical exact-head stable-signed Z Flip/Z Fold install/smoke, Samsung restrictions, one harmless Gemini task and restart/background behavior remain mandatory; old APK hash/certificate evidence cannot be reused.

## Work Management / AI Gateway / shared Android v0.7 contract
- PR #126 `wo047/android-worker-core-v07` is frozen at `7bbaec2e503f579f876d6af96c59911d3a618b84`.
- PR #127 `wo047/api-first-inference-gateway` is frozen at `6c8d006054c04330d353a61acacc7107d53bf4e7`.
- Gate #130 / PR #131 emitted canonical `CONTRACT_V07_READY`.
- Parent Work Management PR #115 remains release-staged; do not create duplicate implementation streams.
- These branches do not authorize MAIN/Production release by themselves.

## Android APP v0.7 — PR #132
- Canonical branch: `wo048/android-v07-api-first-worker`; exact head `76197e75517adf4c6eb4a965f16af7b318a10a1d`.
- CI `33489016994` PASS; Android Worker `33489016990` PASS; independent repository/build review `5077718726` PASS.
- API-first/bank-safety surface declares only `INTERNET`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`; legacy Accessibility/overlay/package automation surfaces are excluded from v0.7 packaging and known provider-key markers are absent from inspected exact-run APK artifact.
- Physical enrollment, hardware-backed Keystore behavior, reboot/network recovery, stable-signed update continuity and real Job -> Inference -> Result/Evidence remain mandatory before release. External banking-app compatibility is not claimed from repository tests.

## Multi-AI zero-cost orchestration — #133 / PR #134
- Canonical branch: `wo048/multi-ai-subscription-orchestration`; exact head `1d808ce46135a7427711608c2dec8cfdbd46810e`.
- CI `33518393104`, Queue `33518392985`, Probe Guard `33518393107`, Vercel Verify `33518392986` PASS; independent cost/security review `5079166931` PASS for repository zero-cost scope.
- Gemini blocks API/Vertex/ADC/base-url/persisted non-account routes; Claude accepts only independently proven Claude App Pro/Max and rejects API/gateway/Bedrock/Vertex/Foundry; OpenRouter is hard-coded to `openrouter/free`; Ollama is local zero-cost fallback.
- No-network self-test covers billing-route denial, config classification, redaction and bounded timeout/kill.
- Real PC01 provider login/quota/capability, parallel executor/reviewer scheduling, reboot recovery and Ollama fallback still require physical E2E evidence.

## Canonical PC01 / physical-device truth
- #57 is the canonical PC01 ingress recovery work order.
- #58 is the deterministic `system.status` canary.
- #100 is the canonical Workforce Controller deployment job.
- #137 is PC01-only and cloud auto-work must not consume it.
- Current evidence still records missing active ingress/bootstrap deadlock. Repository/CI evidence is never PC01/Tailscale runtime evidence; do not create duplicate physical jobs or retry them through cloud AI.

## Release path from current state
1. Freeze PR #116 at reviewed security PASS until physical #57/#58/#100 evidence.
2. Run fresh governance exact-head CI/Queue/Governance Gate + structured 07 review after this state reconciliation; keep global #113 FAIL until live Settings policy is sufficient.
3. Freeze Web PR #117 at `4f9014a...`; wait for exact-head zero-cost Vercel READY, then prove physical pre-routing, #135 one-time migration and full Single Door runtime gate.
4. Freeze #108/PR #109 and PR #132 at reviewed repository heads until exact-head physical device gates.
5. Freeze PR #134 at zero-cost repository PASS until PC01 provider E2E.
6. Do not merge MAIN or promote Production unless applicable gates are simultaneously PASS and Owner release authorization applies.

## External / deferred boundaries
- Vercel filesystem is stateless and never durable Workforce storage.
- Paid provider/billing activation is not authorized by repository implementation alone.
- No provider credentials, Owner credentials, signing secrets or private keys may enter source control, logs or public artifacts.
- If physical install/login/2FA, repository Settings, or deployment quota is the only blocker, record it explicitly and continue other safe work.
