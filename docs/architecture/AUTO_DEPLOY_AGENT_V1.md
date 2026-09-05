# TigerIQ Auto Deploy Agent V1

Status: implementation branch
Scope: PC01-hosted web/apps and future local TigerIQ projects

## Goal
After one trusted bootstrap on PC01, routine application changes must deploy automatically after CI passes. The Owner must not run CMD/PowerShell for normal updates.

## Root cause removed
Runtime deployment MUST NOT depend on a mutable Git working tree. Git ownership, safe.directory, dirty workspace, branch drift and local source edits are not deployment primitives.

## Pipeline
Developer/AI change -> GitHub PR/branch -> CI -> immutable deployment artifact + manifest -> PC01 Deploy Agent -> verify SHA256/source SHA -> stage -> candidate health check -> atomic active-release switch -> restart app -> live health check -> automatic rollback on failure -> evidence/state.

## PC01 model
One persistent `TigerIQ Deploy Agent` runs as SYSTEM. It manages multiple applications from declarative project entries rather than per-update scripts.

Each application entry contains:
- app id
- repository
- release workflow
- tracked branch/channel
- artifact name
- runtime root
- launcher/task name
- private host/port
- health endpoint
- retention count
- optional pre/post activation checks

## Invariants
- No Git clone/fetch/status/config in deployment runtime.
- No shared developer workspace mutation.
- Artifact source SHA and SHA256 must match manifest.
- Candidate must pass health before activation.
- Activation must be atomic/reversible.
- Failed live health automatically rolls back.
- Keep current + previous known-good releases.
- Secrets remain outside artifacts and source control.
- Private bind/Tailscale policy is preserved.
- MAIN/Production release gates remain separate from technical deployment mechanics.

## Command Center V3 implementation
The first app adapter is TigerIQ Command Center:
- GitHub workflow: `.github/workflows/command-center-release.yml`
- updater: `scripts/pc-worker/command-center-updater-v3.ps1`
- one-time bootstrap: `scripts/pc-worker/install-command-center-updater-v3.ps1`
- updater cadence: 2 minutes
- release transport: GitHub Actions artifact
- activation pointer: `F:\TigerIQ\CommandCenter\current-release.txt`
- release store: `F:\TigerIQ\CommandCenter\releases-v3\<sourceSha>`

## Scale-out
The next step is to replace the Command Center-specific updater task with one generic Deploy Agent process and a project registry. Adding a new TigerIQ project then requires only a release workflow + one registry entry; no new PC-side installer per update.
