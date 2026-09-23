# TigerIQ Runtime OpenClaw plugin

OpenClaw tools for PC01:

- `tigeriq_runtime`: bounded Core + Chrome Controller operations.
- `tigeriq_pc`: guarded local PC operator for TigerIQ/OpenClaw runtime maintenance.

`tigeriq_pc` supports:
- exact `TigerIQ ...` Scheduled Task status/start/stop/restart;
- process listing and allowlisted local TCP probes;
- text file read/list/stat inside `D:\TigerIQ`, `D:\OpenClaw`, and `D:\TigerIQ-OpenClaw`;
- text file writes only inside `D:\TigerIQ\State`, `D:\TigerIQ\Evidence`, `D:\TigerIQ\Logs`, and `D:\TigerIQ-OpenClaw\state`;
- a strict diagnostic shell allowlist for read-only Git/OpenClaw/Ollama inspection;
- bounded Power Automate Desktop UI actions through an interactive-session broker: health, launch, window/tree inspection, element invoke/click/value set, and a small allowlist of navigation keys.

Guardrails:
- no arbitrary shell;
- child processes do not inherit TigerIQ/API/token environment variables;
- blocks TigerIQ Secrets, browser profile/session stores, SSH/system credential paths;
- blocks writes to the canonical TigerIQ repository, runtime CoreSource, and `.git`;
- real-path containment checks block junction/symlink escapes for file actions;
- no file delete action;
- no Production deploy/publish or direct main/master mutation through this tool;
- PAD UI automation is restricted to Power Automate Desktop windows/elements; no arbitrary screen coordinates or generic desktop control;
- shell timeout <= 120s; file sizes and output are bounded.

Repository engineering remains GitHub/Coding Lane authority. This plugin is a PC01 runtime operator, not a replacement source-code lane.

## Power Automate Desktop broker

Run `Install-PadUiBroker.ps1` once in the signed-in Windows user session. It registers `TigerIQ PAD UI Broker` as an interactive logon task and stores request/response/heartbeat files only under `D:\\TigerIQ\\State\\pad-ui-broker`. `Uninstall-PadUiBroker.ps1` removes the task. The broker never exposes a network listener.
