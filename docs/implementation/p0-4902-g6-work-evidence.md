# P0 #4902 — G6 Work isolated execution evidence

Scope: `GITHUB_BRANCH_ISOLATED_ONLY`, `NO_PC01_SHELL=true`, `DONE=false`.
Branch: `p0/4902-g6-work-e2e`; target Vy branch, draft only. No merge/deploy.

## Current sources read before branching

- main: `06abf89cd9224a2d0312273d8dbd1817a3704bda`.
- Vy PR #4898: `d57ae78f77d720bc7be1fa875b5328a2af700ba7`, exact branch starting point.
- Work G3 PR #4911: `a5e9879cfc595a49de5c890c5e74be7840084a0d` (untouched).
- Antigravity G5 PR #4912: `fd50aa2647dce7a26924de58b974f14af0a19d7e` (untouched).
- Loader main blob `73288544c4e53f289958fdbf426e470352f040e1`, Issue #504, current Issue #4902 read. Latest issue fields + Owner instruction establish G1–G5 accepted 5/6; historical 3/6 evidence documents are superseded. No G1–G5 canary rerun requested by this suite.
- Existing Vy CI at exact `d57ae78...`: CI/Queue/Vercel/Android and G3 canary success. G3 accepted receipt: https://github.com/newsdayads/tigeriq-ai-lab/issues/4902#issuecomment-6209689564 . Reuse that authorized public-runner/local Ollama route for new G6 work, not another G3 trial.

## Architecture and strict evidence boundary

`tests/g6-work/run.mjs` imports canonical Core shared-resource leases, Coding Lane atomic source claims, manager step compiler/role prompts, review identity/head gate, retry/restart policies and Skill loader. These functions execute unchanged against a fresh real PostgreSQL cluster. Its tables are a minimal isolated schema, not an installed Core database. Core HTTP intake, native manager scheduler and native `runJob` are **not booted**.

Four distinct forked Node worker processes call real local `qwen2.5-coder:7b`, stateless contexts, separate roles and real Core lease tokens: manager plan → implementer code → independent reviewer → acceptor. Same model weights are reused; reviewer is a different worker/context, not a claim of independent model family. Reviewer/acceptor have no mutation tool; model output never runs on the host. The generated function runs only in pinned Node Docker with no network, read-only filesystem, nobody UID, dropped capabilities, CPU/memory/PID/time bounds and a temporary read-only input mount. The function and 12 frozen expectations exercise a real technical artifact, not a model's claim of success.

The host owns expected outputs and retains prompt/response hashes, actual bytes, model/tool image digests, source SHA, Skill id/version/bytes/content SHA256, worker IDs/PIDs and lease tokens (ephemeral sandbox only). Models cannot publish GitHub acceptance. The JSON policy fixture tests are **synthetic negative tests**, never live evidence.

Full service E2E remains `REAL_WORKER_E2E_BLOCKED`: this test adapter does not demonstrate live Core intake → native Coding Manager dispatch → native worker completion → exact-source GitHub G5 product acceptance. A temporary generated function has no committed product-source SHA/check-run; canonical G5 gate must reject missing provider/acceptor. No fake GitHub transport or mock acceptor is supplied. GitHub runner evidence is not PC01 installed-runtime/release rollback proof.

## Commands and scenario contract

```
node --test tests/g6-work/receipt-policy.test.mjs
node tests/g6-work/run.mjs
```

Second command intentionally requires this exact branch, public GitHub-hosted Linux runner, exact checkout SHA and explicit zero-cost scope. Local Work environment has no PostgreSQL/Docker executable; it cannot establish live worker PASS. Workflow provisions only a disposable native PostgreSQL cluster on a private Unix socket (no TCP listener, no existing role/credential changes), local model container and per-function tool container. No Production connection or PC01 shell is used.

Scenarios: two simultaneous real workers contend for one lease; separate worker source claims reject duplicate dispatch; terminated PostgreSQL connection rolls back uncommitted effect; SIGKILL worker plus actual 30-second lease expiry/recovery/takeover; stale lease token cannot heartbeat/release replacement; canonical retry policy persists history in PostgreSQL and stops attempt 3 after 2 failures; PostgreSQL read-only role cannot mutate; real manager/implementer/reviewer/acceptor model flow; 12 functional outputs; canonical product gate refuses synthetic acceptance; temporary artifact rollback preserves checked-out source. Retry test uses real durable storage with the canonical decision function; it does not restart the production scheduler. Rollback means database crash transaction + temporary artifact removal, not production version restoration.

Missing permissions/models/tools/Skill hashes/lease/evidence, CANDIDATE, self-review, altered output, networked/writable tool and rejected reviews fail closed. Never promote CANDIDATE or weaken G1–G5 security to obtain PASS.

## Results

Local G6 policy tests: 24/24 PASS; syntax PASS. Initial source `043c3830529a5daa4a3109e47af9c056ce0f2e7d` failed before worker/model invocation: G6 harness relative imports traversed one directory too far. Root cause and fix confined to G6 runner/worker; dependency import preflight added before downloads. Failed run preserved at https://github.com/newsdayads/tigeriq-ai-lab/actions/runs/38870947509 . Model container cleanup passed; no PostgreSQL cluster was started. This is a G6 harness defect, not a regression of G1–G5.

The next exact-HEAD run must establish live evidence. `receipt.json` artifact is authoritative for each scenario, live role receipts, failures and cleanup. CI success means only the scoped imported-component sandbox passed; `production_runtime_accepted=false`, G6 not DONE.

## Open audit items and next action

Vy must inspect independent receipts and integrate the same harness through the actual native dispatch lifecycle with exact-source product checks. Any common-source defect is handed off with reproduction, not patched in this branch. Owner keeps final release gate. Resource cleanup runs on failure; kill model/tool containers and stop/remove the isolated PostgreSQL cluster, leaving existing system DB/services untouched.

`DRIVE_SYNC=NOT_REQUIRED`: isolated G6 tests/workflow/evidence only; Loader/bootstrap unchanged.
