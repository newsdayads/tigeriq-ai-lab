# WO-008 — GitHub Command Ingress to PC01

Priority: P0
Status: IMPLEMENTED — PHYSICAL INSTALL/CANARY PENDING
Date: 2026-08-29

## Objective
Allow the Chief of Staff to turn Owner chat instructions into a durable GitHub-backed job that PC01 automatically polls, claims, executes through local Ollama, independently reviews/judges, records as evidence, and closes without requiring manual PowerShell per job.

## Design
- GitHub Issues are the ingress/queue and audit trail.
- A job is an open issue containing marker `TIGERIQ_JOB_V1` and an `## Instruction` section.
- PC01 polls every 30 seconds using authenticated `gh` CLI.
- Claim/result markers are recorded as issue comments: `TIGERIQ_PC01_CLAIMED`, `TIGERIQ_PC01_DONE`, `TIGERIQ_PC01_FAILED`.
- Local durable state at `F:\TigerIQ\Worker\queue-state.json` suppresses duplicate completed jobs after restart.
- Executor/reviewer/judge are separate agent roles. Reviewer and judge use structured JSON gates.
- Default model is `qwen2.5-coder:14b` over loopback Ollama; no non-loopback Ollama exposure is required.
- Successful jobs are closed only after REVIEW + DONE gates pass.

## Safety
- No MAIN/Production mutation is authorized by this Work Order.
- No secrets are stored in issue bodies/comments or repository files.
- GitHub authentication remains in the local `gh` credential store.
- Worker installation backs up the prior `worker.py` before replacement.
- A canary job performs no external mutation and must pass before ingress is considered ready.

## Implementation
- `scripts/pc-worker/worker-github-queue.py`
- `scripts/pc-worker/install-github-queue.ps1`

## Remaining gate
Run the installer once on physical PC01. It installs the queue worker, restarts the existing Scheduled Task, creates a canary issue, waits for automatic pickup, and only reports `[100%] TIGERIQ COMMAND INGRESS READY` after PC01 closes the canary through its own executor/reviewer/judge flow.
