# P0 #4902 — G6 Work isolated execution evidence

Scope: `GITHUB_BRANCH_ISOLATED_ONLY`, `NO_PC01_SHELL=true`, `DONE=false`.
Branch: `p0/4902-g6-work-e2e`; target Vy branch, draft only. No merge/deploy.

## Current sources read before branching

- main: `06abf89cd9224a2d0312273d8dbd1817a3704bda`.
- Vy PR #4898: `d57ae78f77d720bc7be1fa875b5328a2af700ba7`, exact branch starting point.
- Compatibility parent refreshed to `b787982889f840200e727fee42f2f4664c98066a` on Work branch only. Vy added the Owner-held status to canonical G6; Work inherited those exact blobs without editing them. Compare against that parent contains only the six G6 additions.
- Work G3 PR #4911: `a5e9879cfc595a49de5c890c5e74be7840084a0d` (untouched).
- Antigravity G5 PR #4912: `fd50aa2647dce7a26924de58b974f14af0a19d7e` (untouched).
- Loader main blob `73288544c4e53f289958fdbf426e470352f040e1`, Issue #504, current Issue #4902 read. Latest issue fields + Owner instruction establish G1–G5 accepted 5/6; historical 3/6 evidence documents are superseded. No G1–G5 canary rerun requested by this suite.
- Existing Vy CI at exact `d57ae78...`: CI/Queue/Vercel/Android and G3 canary success. G3 accepted receipt: https://github.com/newsdayads/tigeriq-ai-lab/issues/4902#issuecomment-6209689564 . Reuse that authorized public-runner/local Ollama route for new G6 work, not another G3 trial.

## Architecture and strict evidence boundary

`tests/g6-work/run.mjs` imports canonical Core shared-resource leases, Coding Lane atomic source claims, manager step compiler/role prompts, review identity/head gate, retry/restart policies and Skill loader. These functions execute unchanged against a fresh real PostgreSQL cluster. Its tables are a minimal isolated schema, not an installed Core database. Core HTTP intake, native manager scheduler and native `runJob` are **not booted**.

Four distinct forked Node worker processes call real local `qwen2.5-coder:7b`, stateless contexts, separate roles and real Core lease tokens: manager plan → implementer code → independent reviewer → acceptor. Same model weights are reused; reviewer is a different worker/context, not a claim of independent model family. Reviewer/acceptor have no mutation tool; model output never runs on the host. The generated function runs only in pinned Node Docker with no network, read-only filesystem, nobody UID, dropped capabilities, CPU/memory/PID/time bounds and a temporary read-only input mount. The function and 12 frozen expectations exercise a real technical artifact, not a model's claim of success.

The host owns expected outputs and retains prompt/response hashes, actual bytes, model/tool image digests, source SHA, Skill id/version/bytes/content SHA256, worker IDs/PIDs and lease tokens (ephemeral sandbox only). Models cannot publish GitHub acceptance. The JSON policy fixture tests are **synthetic negative tests**, never live evidence.

Full service E2E remains `REAL_WORKER_E2E_BLOCKED`: this test adapter does not demonstrate live Core intake → native Coding Manager dispatch → native worker completion → exact-source GitHub G5 product acceptance. The unchanged native service admission probe records `GITHUB_TOKEN_MISSING`: CI holds no branch-scoped writer adapter, connector credentials cannot be exported, and source-native planning/writes use main. No new permission or token is granted to bypass this. A temporary generated function has no committed product-source SHA/check-run; canonical product gate must reject missing provider transport (`CODING_PRODUCT_PROVIDER_ADAPTER_UNAVAILABLE`). Actual G5 module is present, imported unchanged; this is **not** a G5 regression or withdrawal of acceptance. No fake GitHub transport or mock acceptor is supplied. GitHub runner evidence is not PC01 installed-runtime/release rollback proof.

## Commands and scenario contract

```
node --test tests/g6-work/receipt-policy.test.mjs
node tests/g6-work/run.mjs
```

Second command intentionally requires this exact branch, public GitHub-hosted Linux runner, exact checkout SHA and explicit zero-cost scope. Local Work environment has no PostgreSQL/Docker executable; it cannot establish live worker PASS. Workflow provisions only a disposable native PostgreSQL cluster on a private Unix socket (no TCP listener, no existing role/credential changes), local model container and per-function tool container. No Production connection or PC01 shell is used.

Scenarios: two simultaneous real workers contend for one lease; separate worker source claims reject duplicate dispatch; terminated PostgreSQL connection rolls back uncommitted effect; SIGKILL worker plus actual 30-second lease expiry/recovery/takeover; stale lease token cannot heartbeat/release replacement; canonical retry policy persists history in PostgreSQL and stops attempt 3 after 2 failures; PostgreSQL read-only role cannot mutate; real manager/implementer/reviewer/acceptor model flow; 12 functional outputs; canonical product gate refuses synthetic acceptance; temporary artifact rollback preserves checked-out source. Retry test uses real durable storage with the canonical decision function; it does not restart the production scheduler. Rollback means database crash transaction + temporary artifact removal, not production version restoration.

Missing permissions/models/tools/Skill hashes/lease/evidence, CANDIDATE, self-review, altered output, networked/writable tool and rejected reviews fail closed. Receipt policy has 29 tests (synthetic policy fixtures explicitly labelled). Actual subprocess also rejects an unauthorized model role before invocation. Never promote CANDIDATE or weaken G1–G5 security to obtain PASS.

## Results

Local G6 policy tests: 29/29 PASS; syntax PASS. Initial source `043c3830529a5daa4a3109e47af9c056ce0f2e7d` failed before worker/model invocation: G6 harness relative imports traversed one directory too far. Root cause and fix confined to G6 runner/worker; dependency import preflight added before downloads. Failed run preserved at https://github.com/newsdayads/tigeriq-ai-lab/actions/runs/38870947509 . Model container cleanup passed; no PostgreSQL cluster was started. This is a G6 harness defect, not a regression of G1–G5.

Second source `6aeeaf2efcc3e9f7fb8a64345f3773eed4c7d781`: CI Verify, Frontend Functional Verify and Backend Contract Verify SUCCESS (repository PR automation, no manual rerun of accepted G1–G5). G6 live run https://github.com/newsdayads/tigeriq-ai-lab/actions/runs/38871158367 failed closed: 3 real scenarios PASS (lease contention, duplicate source dispatch, connection-loss rollback), then PostgreSQL `42P01` during expired-lease recovery because the G6 minimal schema omitted `tigeriq_jobs` referenced by Core orphan recovery. No model invoked. Worker IDs `02c4783c-d795-480b-8219-9515e70ad9d6` / `b10f3bc7-1ec7-4b9e-a343-b53ee3b04202`, lease `7330ecc9-88a0-4440-a7bf-13379adeb290`. PostgreSQL/process/model cleanup passed. Artifact https://github.com/newsdayads/tigeriq-ai-lab/actions/runs/38871158367/artifacts/12033194723 . Fix: add the required real table to G6 schema, not common source; explicitly request 30s TTL through canonical API (first trial correctly waited its actual default 5 minutes). No timestamp rewrite, lock bypass or acceptance relabeling.

The final exact-HEAD run is the next authority for live results. The workflow https://github.com/newsdayads/tigeriq-ai-lab/actions/workflows/p0-4902-g6-work-e2e.yml uploads `receipt.json` and raw candidate; `source_sha` must equal the final PR head. Final run/job/artifact URLs, all worker/lease IDs and scenario results are written to Issue #4902 with marker `P0_HANDOFF_G6_WORK_E2E_READY_FOR_VY_AUDIT` after independent readback. This avoids falsely embedding a previous SHA's PASS into a new commit. CI success means only the scoped imported-component sandbox passed; `production_runtime_accepted=false`, G6 not DONE.

## Open audit items and next action

Vy must inspect independent receipts and integrate the same harness through the actual native dispatch lifecycle with exact-source product checks. Any common-source defect is handed off with reproduction, not patched in this branch. Owner keeps final release gate. Resource cleanup runs on failure; kill model/tool containers and stop/remove the isolated PostgreSQL cluster, leaving existing system DB/services untouched.

`DRIVE_SYNC=NOT_REQUIRED`: isolated G6 tests/workflow/evidence only; Loader/bootstrap unchanged.
