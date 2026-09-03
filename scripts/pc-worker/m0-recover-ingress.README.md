# M0 ingress recovery

One-shot PC01 recovery helper for the TigerIQ RESET M0 phase.

Safety contract:
- pinned to PC01;
- requires elevated PowerShell;
- does not delete files, stop services, modify MAIN, reboot, or install software;
- only enables/starts the existing scheduled tasks `TigerIQ Worker`, `TigerIQ Worker Watchdog`, and `TigerIQ-PC01-Worker` when present;
- writes local evidence under `F:\TigerIQ\Logs`.

This is a bootstrap recovery path only. It is not the canonical TigerIQ V2 runtime queue or state authority.
