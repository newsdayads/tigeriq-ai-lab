# TigerIQ PStack — T04 native isolated sandbox runbook (pre-execution)

WORK_ORDER=https://github.com/newsdayads/tigeriq-ai-lab/issues/5012
SOURCE_PR=https://github.com/newsdayads/tigeriq-ai-lab/pull/5003
SOURCE_BASELINE_HEAD=27d20e03669febea4fe08486229aa5121517bfef
RESOURCE_SCOPE=TIGERIQ_PSTACK_PORTABLE_VERIFICATION_PILOT
RECORD_TYPE=SOURCE_GROUNDED_T04_RUNBOOK_ONLY
T04_GO_NO_GO=NO_GO_UNTIL_NATIVE_ISOLATION_AND_AUTHORIZED_OPERATOR_RECEIPT
DONE=false
CURRENT_ACCEPTANCE=4/15
NO_RUNTIME_OR_PRODUCTION_CHANGE=true

This is an operator checklist **not a launch authorization**, a synthetic proof, or an automatically usable CLI. A source-only review does not accept T04. No code below is a command to run on PC01 by default.

## 1. Verified source facts and dependencies

| Check | Actual source | Operational consequence |
|---|---|---|
| Core database is mandatory | `apps/tigeriq-core/core.mjs`: reads `process.env.DATABASE_URL`, throws `DATABASE_URL_MISSING` when absent | Merely switching HTTP port cannot isolate data; never use a PC01/shared DATABASE_URL |
| Core binds loopback with default HTTP port 8795 | `TIGERIQ_CORE_HOST`, `TIGERIQ_CORE_PORT` in `apps/tigeriq-core/core.mjs` | Sandbox must use a uniquely owned port; 3150/3210/8795/8796/8797/8801 are forbidden verifier targets |
| Work projection calls hard-coded bridge | `apiHealthWorkProjection()` in `apps/tigeriq-core/core.mjs` fetches `http://127.0.0.1:8801/status` | Core and disposable bridge must share one private network namespace; a different Core port alone is NOT isolation |
| Verification requires a live native readback function | `verifyRuntimeIsolation()` and `runSandboxVerification()` in `scripts/verify-core-ui-sandbox.mjs` | JSON fixtures, Issue comments, tests and green CI must not be used as proof from an authorized native operator |
| CLI entrypoint does not inject an inspector | `main()` in `scripts/verify-core-ui-sandbox.mjs` supplies only URL, Issue and evidence-dir | The CLI currently fails closed with `SANDBOX_NATIVE_READBACK_REQUIRED`; DO NOT run it expecting T04 acceptance, and do not bypass the gate |
| HTTP + WebSocket UI traffic is sandbox-only | `driveWorkCard()` uses `context.route()` and `context.routeWebSocket()` | Browser routing is defense-in-depth; it does not certify OS-level or Docker/VM isolation |
| Disposable Postgres has been run in existing CI | `tests/run-postgres-isolated-ci.mjs` on GitHub-hosted Linux; prior logs in #5012 | This confirms only a DB test with teardown, NOT a full product stack |

## 2. Candidate isolated execution surfaces — current decision

1. **PC01 Windows / RDC SYSTEM: NO-GO.** The latest native readback on Issue #5012 shows Windows Sandbox/Containers disabled; WSL access via RDC LocalSystem returns `WSL_E_LOCAL_SYSTEM_NOT_SUPPORTED`; no proven pre-authorized user-context sandbox operator. Do not switch user, install/enable Windows features, run WSL in another identity, modify services, or touch Chrome/App Chrome to evade these gates.
2. **Disposable GitHub-hosted Ubuntu runner: CANDIDATE ONLY.** A GitHub-hosted runner can create and drop a temporary PostgreSQL database, as already proven. It does **not** yet prove a private full-stack namespace, Core/bridge launch readiness, browser profile isolation or post-run cleanup. Before any new hosted execution, verify actual GitHub Actions billing/quota policy for this public repository, runner configuration, Docker availability, and a task-scoped authorized isolated operator; never assume CI green or a public repository grants the remaining privileges.
3. **An existing owned sandbox with trusted native operator: CANDIDATE ONLY.** The operator must show current authority, scope, owner, independent process/network/DB/profile readback, and permission to create/teardown disposable resources. Do not acquire a disputed Core lease or reuse an active host runtime.

Choose exactly **one** candidate with fresh verified permission and isolation receipts; do not set up two writers or use Production/PC01 as a fallback.

## 3. Pre-launch GO gate — all items required, otherwise STOP

- [ ] Authorized native operator established: identity, allowable device/runner, approved action scope and (if applicable) owned atomic lease/fencing token.
- [ ] Zero new payment, no credential changes, no security-boundary changes, no protected/main edits, no destructive or live-PC01 actions.
- [ ] Runner/process isolation independent of current PC01 Core, bridge and DB is proven **before** starting a service; exact source checkout commit and build input are pinned.
- [ ] A new disposable PostgreSQL cluster/DB and least-privilege role exist outside Production; DB fingerprint, cluster identity and unique random test name are observed from the DB connection itself, not from a declared environment variable.
- [ ] The operator can create a **private network namespace** for both Core and bridge, with internal bridge `127.0.0.1:8801`; the inspector/browser must access the sandbox Core loopback from the same valid namespace. Host namespace must be different.
- [ ] Bridge startup input is genuine and allowed; Work projection uses an actual source Issue and fresh status, **no fake bridge payload or mocked HTTP**.
- [ ] Dedicated Chromium context/profile is demonstrably separate; no reuse of App Chrome or any NV02/NV03/NV04 session. Evidence output must be new under `artifacts/pstack-verification/<unique-run>/`.
- [ ] No automatic production integrations, mutation jobs, external paid providers or user credentials will start as a side effect of launching `core.mjs`; if this cannot be independently audited and constrained, STOP.
- [ ] The verifier is wired to a **real authorized native inspector**, not arbitrary supplied JSON. The current CLI is intentionally not wired, so a vetted adapter/executor is needed before live use.

No GO gate item can be waived because the HTTP endpoint responds, because a unit test passed, or because CI supplies a temporary database.

## 4. Launch → Doctor → Drive → Evidence → Cleanup (AUTHORIZED OPERATOR ONLY)

**Launch:** Record a unique `runId`, exact 40-char Git commit SHA, disposable DB fingerprint/cluster, test role, host netns ID, sandbox netns ID, Core PID/port, bridge PID/port, network bindings, browser profile ID, ownership and start times. Use a private namespace and separately owned disposable resources; bind the Core test port away from known live ports. Start only after all Pre-launch checks have passed. Do not seed or mutate a live database.

**Readiness:** Independently observe the process executable/build SHA and its PID; prove that Core and bridge PIDs are live and belong to the same sandbox netns, while the host is in a different namespace; verify Core's DB points to the disposable cluster and has a distinct observed fingerprint. Verify the browser user-data/profile directory and that it differs from the shared profile. Capture operator source/time and a durable `evidenceRef`; reject evidence older than 120 seconds.

**Doctor:** Run `runSandboxVerification()` through a vetted authorized adapter passing `nativeIsolationInspector`; only then GET sandbox `/api/status`, checking `status.core.pid` against the native readback, then GET `/api/health-live-work` with one actual existing Issue, a fresh generation timestamp and `stale=false`. Any mismatch → BLOCKED; no browser navigation. The source's standalone CLI cannot meet this requirement yet.

**Drive:** With Playwright and its HTTP/WebSocket guards, open the one work row and its detail modal. Record before/after text, true GitHub issue URL, screenshot, network/server logs and an actual Playwright trace. The harness now requests Playwright tracing and checks that both screenshot and trace files exist and are nonempty (source patch `fb92851ce7d9c4f8043047a4680b68ec038bddaa`, CI 39155668155). This is **source/CI evidence only**; T06 still requires a real browser trace from an authorized isolated full-stack run, server logs and teardown receipts. Never call fixture/mocked API data real evidence.

**Evidence:** Persist a manifest containing `runId, observedAt, sourceSha, corePid, bridgePid, corePort, bridgePort, sandboxNamespace, hostNamespace, dbFingerprint, hostDbFingerprint, profileId, sharedProfileId, issueNumber, API status/result, screenshot path/hash, trace path/hash, log path/hash`. Attach the independent operator's real readback reference and test-suite status. Missing fields remain `NOT_VERIFIED`; never invent placeholders as if observed.

**Cleanup:** Shut down **only the processes/profile/namespace created for the exact run**. Drop **only** the random disposable DB/role/cluster that the run created, with owner and resource identity re-checked before deletion. Preserve receipts outside the ephemeral namespace, check that sandbox PIDs/listeners disappeared and test DB/role are gone, and capture teardown proof. If ownership is uncertain, STOP without destructive fallback and report external wait.

## 5. Current operator ticket and hard boundary

```text
ACTION=T04_FULL_STACK_ISOLATED_NATIVE_READBACK
WORK_ORDER=5012
RESOURCE_SCOPE=TIGERIQ_PSTACK_PORTABLE_VERIFICATION_PILOT
EXACT_SOURCE_SHA=REVALIDATE_PR5003_HEAD_BEFORE_START
STATUS=EXTERNAL_WAIT
REQUIRES=AUTHORIZED_OPERATOR,DISPOSABLE_POSTGRES,PRIVATE_CORE_AND_BRIDGE_NETNS,INDEPENDENT_CHROME_PROFILE,VERIFIED_COST_AND_PERMISSION,REAL_INSPECTOR,TRUSTED_CLEANUP
FORBIDS=PC01_SHARED_DB,PC01_SHARED_BRIDGE,APP_CHROME,PRODUCTION,PAID,NEW_CREDENTIALS,NO_RDC_OR_NO_PC01_SHELL_BYPASS,FAKE_NATIVE_JSON
ACCEPTANCE=T04_NATIVE_PROCESS_DB_NAMESPACE_BROWSER_AND_TEARDOWN_RECEIPTS
NEXT_IF_GO=T05_REAL_DOCTOR_THEN_T06_REAL_PLAYWRIGHT
NEXT_IF_NO_GO=EXTERNAL_WAIT_WITH_EXACT_UNMET_GATES
```

**This runbook is source-only preparation, not T04 runtime acceptance.** Keep PR #5003 OPEN DRAFT until T07/T08; #5012 remains `4/15, DONE=false`. No Source Registry Skill is activated by this document.
