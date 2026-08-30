# WO-010 Extension — PC01 Server Activity Telemetry

Status: ACTIVE — required before final physical smoke gate

## Goal
Add evidence-backed PC01 server activity to TigerIQ Command Center so the Owner can see whether the always-on local server is healthy and what it is doing.

## Required owner-facing telemetry
- Server name / PC01 identity and heartbeat timestamp.
- CPU utilization percent.
- RAM used / total and percent.
- System uptime.
- Disk free / total for the TigerIQ workspace drive.
- PC01 worker process state and PID.
- Current queue/job identity when available without leaking prompt/private content.
- Current Work Order/state derived from safe runtime evidence.
- Ollama availability and configured model name; do not expose request bodies/prompts.
- Tailscale/private IP and private connectivity state.
- GPU telemetry only when a reliable local source exists; otherwise render `Chưa có telemetry`, never fabricate.

## Security/privacy invariants
- No passwords, API keys, cookies, auth headers, command secret, private Owner Profile, prompt bodies or private file contents in telemetry/logs.
- Default/private Tailscale-only exposure remains unchanged; never bind public wildcard by default.
- Telemetry endpoint is read-only.
- Sampling must be bounded and must not materially load PC01.

## UI
Desktop: Server/PC01 panel in the right column with compact live metrics and current activity.
Mobile/iPhone: collapsible/stacked Server panel after active Work Orders, with large status pills and readable metric rows.
Refresh target: <=15 seconds, matching Command Center status refresh.

## Gate
Implementation + unit/security tests + CI PASS + independent review/judge + physical PC01/Tailscale smoke evidence. MAIN/Production remain untouched.
