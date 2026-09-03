# WO-057 Repository Gate Evidence — 2026-09-03

Status: PASS — repository implementation gates only
Physical PC01 gate: NOT YET EXECUTED / NOT CLAIMED
Branch: `wo057/pc01-primary-ai-compute-node`
Verified implementation head: `cd61e11d477191e0260a9264547c3372539e822f`
GitHub Actions run: `33720417131`
MAIN/Production: untouched
OpenClaw dependency: none

## Repository gates

### Linux quality gate — PASS
- `npm ci` PASS; 0 reported npm audit vulnerabilities.
- TypeScript typecheck PASS.
- Unit tests PASS: 12 test files / 58 tests.
- 3 existing PostgreSQL/device integration tests skipped because their external integration environment was not configured in the hosted runner; they are not counted as PASS.
- Build PASS.
- Security/resource contract PASS:
  - no OpenClaw startup/auth dependency in PC01 worker/deployment scope;
  - no `shell:true` / raw `exec(` in Native Worker executor;
  - Ollama `think:false` enforced;
  - default `num_ctx=4096` enforced;
  - local AI max concurrency `2` enforced;
  - worker instantiates Ollama at `(4096,2)`;
  - protected branch checkout deny contract present.

### Windows build gate — PASS
- Node 20 typecheck PASS.
- Unit tests PASS.
- Build PASS.
- `dist/apps/pc01-native-worker/src/standalone.js` present.
- Windows PowerShell 5.1 parser PASS for:
  - `scripts/pc01-primary-node/Install-PC01-PrimaryNode.ps1`
  - `scripts/pc01-primary-node/Invoke-PC01-PrimaryNode-E2E.ps1`

## Root-cause/fix evidence
1. Initial CI failure: Node 20 `fetch` body typing rejected a `Buffer` in the signed Controller client.
   - Fix: preserve byte-exact hash/signature input, send the same UTF-8 payload as a string to `fetch`.
   - Retest: Linux/Windows typecheck PASS.
2. Windows PowerShell 5.1 parser failed on the exact Vietnamese TEST C prompt in a UTF-8-no-BOM script.
   - Root cause confirmed at `Invoke-PC01-PrimaryNode-E2E.ps1` line 26.
   - Fix: keep the exact Vietnamese prompt as UTF-8 Base64 and decode it at runtime; script source stays encoding-safe ASCII.
   - Retest: Windows PowerShell parser PASS.

## Capability evidence at repository level
PASS:
- Native Worker registration/heartbeat/lease/renew/result lifecycle implemented.
- Authenticated Work Order ingress implemented and unit tested.
- Ollama adapter defaults and metrics implemented and unit tested with a protocol-compatible mock.
- Router implemented and unit tested.
- Safe structured Tool Executor implemented and unit tested.
- Resource scheduler / local-AI semaphore max=2 implemented and unit tested.
- Evidence persistence implementation present.
- Fail-closed cloud route present; no unconfigured provider is claimed.
- One canonical worker autostart/recovery installer implemented and PowerShell 5.1 parse-tested.
- Physical A–G E2E test package implemented and parse-tested.

NOT CLAIMED:
- actual PC01 employee/device rows >=1;
- actual PC01 ONLINE heartbeat;
- actual qwen3:8b GPU processor evidence after deployment;
- actual physical Work Order → lease → Worker → Ollama/tool → result → PostgreSQL lifecycle;
- actual physical failure/recovery/concurrency A–G PASS;
- independent AI reviewer PASS.

## Physical gate required for DONE
Run the PC01 one-click installer and then `Invoke-PC01-PrimaryNode-E2E.ps1` on PC01. The physical gate will create machine-readable evidence at:

`docs/evidence/WO-057-PC01-PRIMARY-NODE-E2E-<timestamp>.json`

Only that evidence may close the remaining physical Definition-of-Done items.
