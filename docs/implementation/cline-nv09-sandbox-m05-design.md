# #4532 — M05 / S2: Cline–NV09 isolated-execution design (source-only proposal)

**Work order:** #4532 — `[P1][NỀN TẢNG TIGERIQ][CLINE] Kiểm chứng Cline và tích hợp thử với NV09 có nghiệm thu`.

**State:** `DESIGN_ONLY_NOT_DEPLOYABLE`, `executionEnabled=false`. This is a proposed security contract and static validator, **not** an operational sandbox, approved security change, executable deployment configuration, Core ownership claim, or an attestation. M01–M02 accepted; M03–M12 remain unaccepted until independently evidenced.

## 1. Isolation model

- Run Cline and NV09 in two **separate, ephemeral, non-shared** workspaces, `/workspaces/cline` and `/workspaces/nv09`, under their own execution scope. Neither agent can access the other workspace or receipt storage; agent-written data must never determine benchmark success without independent scorer verification.
- Underlying runtime **MUST** enforce pinned non-root UID **10001**, pinned primary GID **10001**, no supplementary groups (all three OS-enforced and attested), immutable read-only base filesystem, only its assigned tmp/workspace as writable, no extra privileges, capability set empty, `noNewPrivileges`, verified seccomp profile, explicitly required isolated user/mount/process/network namespaces, no access to host devices or Docker/SSH sockets. These are **requirements**, not claims of implemented runtime controls.
- No mount or path into the coordinator/PC01 host filesystem, no host HOME, secrets, profiles, credentials, API tokens or authorized browser session, and no host sockets. The separate trusted outer coordinator may retain receipts in a path unavailable to the agent. Workspaces must be created by the trusted coordinator, not reused across jobs.
- Default-deny external network/DNS. Only a **verified local-only Ollama relay** may eventually be enabled via separately reviewed OS/network isolation and an action-specific scope; no direct host-network mode, raw `localhost:11434`, HTTP gateway, cloud provider or internet. `relayAddress` and model digest remain unresolved placeholders until an explicit independent verification. Do **not** run using this design file or treat it as deployable.
- Cline and NV09 use identical pinned local model digest, verified source manifest SHA, fixture test suite and time/resource budgets. Keep separate timestamps, hashes, stdout/stderr/exit receipts and independent review results for each of 3+3 fixtures when execution becomes authorized.

## 2. Proposed ceilings (require capacity review)

| Control | Candidate ceiling | Enforcement/verification gate |
|---|---:|---|
| Wall-clock time per run | 180 seconds | Trusted parent watchdog and cgroup process-group cleanup |
| CPU | 2 logical cores | cgroup CPU quota; negative test exceeding quota |
| Memory | 2 GiB | cgroup memory ceiling; independent observed RSS |
| PIDs | 64 | pids controller |
| Writable storage | 128 MiB per workspace | Separate ephemeral filesystem quota |
| Output stream | 1 MiB | Trusted host-side output cap |
| Fixture file | 1 MiB | V6 static scorer guard, plus OS quota |
| Fixture-tree entries / depth | 256 / 24 | V6 scorer guard, plus outer watchdog |
| Paid cost | $0 | Local-only provider; no cloud-paid fallback |

**Important:** Static JSON or Node validation does not enforce CPU, memory, pids, mount, network or filesystem constraints. Each claimed control needs actual OS/process/network evidence from the authorized test environment, not copied config flags.

## 3. STOP/acceptance gates

1. **M03 ownership:** atomic resource-scoped Core writer lease (live receipt with lease ID, scope and owner) and no conflicting writer; issue `MUTATION_OWNER=NONE` is **not** evidence of a lease.
2. **M04 source reconciliation:** exact GitHub main SHA, prior seven accepted changes, current V6 code patch and review. Non-main branch, exact-head CI under Node20; do not alter main directly.
3. **M05 design review:** independent security/code review of namespace, mounted paths, proxy route, policy ceilings, rollback, special files/links, Windows behavior, and reconciliation of source+policy patch. Passing the static policy tests below is **necessary but insufficient** for M05 acceptance.
4. **M06 runtime attestation:** OS isolation proof, negative escape tests (host paths, secret files, unrestricted network, other workspace access, resource exhaustion), observed network/firewall namespaces, process privilege maps and cleanup evidence. Failure stops agent execution.
5. **M07 execution authorization:** approved action-specific fixed Core `cline_benchmark_run` allowlist and pinned model digest. Unauthorized executable/shell/PC01/App Chrome actions remain forbidden.
6. **M08–M10 measured comparison:** real, independently attested Cline and NV09 3/3 fixture executions and decision gate results; no synthetic receipt may be promoted to acceptance.
7. **M11–M12 conclusion:** gated REJECT/CANARY/KEEP based only on actual measurements, peer review, CI, signed independent receipts, and final Owner-directed disposition.

## 4. Required negative probes AFTER action-specific authorization

- Attempt access to host HOME, `.ssh`, environment/API keys, host Docker socket and coordinator receipts from inside either worker: must be denied and independently logged.
- Try worker A reading/writing worker B's workspace; try symlink, hardlink, FIFO, socket and path-swap attacks while scoring: fail closed. Race-freedom cannot be inferred from the V6 source guards alone.
- Attempt unrestricted public DNS/HTTP, host network, and a second provider: fail closed; separately confirm a narrowly pinned local Ollama relay succeeds without host-network mode.
- Exceed CPU/RAM/PID/storage/output/timeout ceilings; confirm bounded kill, no leaked process/port/files, and signed failure receipts. Verify reboot/retry also requires a **new lease**, never duplicate side effects.
- Verify normal 3 fixture baselines and acceptance-score behavior; guard against test mutability, empty directory additions, lane siblings, malformed score receipts and falsely skipped TAP assertions.

## 5. Rollback / source limits

- Trusted parent terminates the process group, revokes temporary relay, destroys *only* isolated workspace created for that run, and stores immutable receipts away from agent write paths. Destruction of host/Production data is prohibited.
- No direct main/Production deployment, paid cost, credential or security-boundary change, workstation shell, Codex, RDC, or App Chrome operations without separate explicit approval.
- The `sandbox-policy.candidate.json` file deliberately cannot be used to launch an agent (`executionEnabled=false` and unresolved relay/attestation placeholders). Its validator checks **design consistency only**. The real enforcement adapter, relay address, seccomp profile and OS evidence are *unselected*, not guessed.

## 6. Reproducible static tests

`node --test tests/cline-nv09-sandbox-policy.test.mjs`

Negative probes mutate a clone of the design and assert fail-closed behavior. Include this test in the existing `tests/cline-executor-benchmark.test.mjs` test entrypoint in the eventual, lease-authorized source patch because repository `package.json` enumerates Node tests explicitly. Run GitHub Actions exact-head CI and request independent review; local Node 22 execution is not Node 20 verification or an isolation attestation.

## 7. M05 policy contract hardening (candidate V2)

The design file now explicitly records `runtime.userNamespaceIsolationRequired=true` and
`runtime.mountNamespaceIsolationRequired=true`. The static validator rejects either
requirement being disabled, omitted or represented as a string. The required state is
**design intent only**; neither boolean establishes an actual Linux namespace,
proof of network/file isolation, or permission to launch an agent. A separate
OS-level negative probe and independent receipt are still mandatory for M06.

## 8. M05 process identity hardening (candidate V3)

Static validation now pins `runtime.userId=10001`, `runtime.groupId=10001`,
and `runtime.supplementaryGroupIds=[]`; rejects all noncanonical UID/GID,
root/privileged supplementary groups, and string-valued IDs. This prevents
a static policy's "non-root" claim from silently accepting a different OS
identity or undeclared supplementary groups. **This is a design requirement
only.** A real sandbox MUST independently prove UID/GID maps, the actual
process group set and namespace isolation before any worker execution.

## 7. Child-process environment isolation

- Fixture test subprocesses inherit only the minimum platform path variables needed to start Node: `SystemRoot`, `WINDIR`, `PATH`, `PATHEXT` when present.
- Host `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TEMP`, `TMP`, and `TMPDIR` are never forwarded. During scoring they are rebound to the absolute disposable fixture workspace.
- Credential variables, `NODE_OPTIONS`, and `NODE_TEST_CONTEXT` remain excluded. This source rule is defense-in-depth only; it does not replace OS sandbox attestation.
