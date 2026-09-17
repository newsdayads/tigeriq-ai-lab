# TigerIQ Worker Utility V1 — Watchdog UX (NV03)

Scope: presentation-only contract for #793 P0 watchdog. This document does not implement watchdog/recovery logic.

## Health states
| State | Trigger/display | Allowed primary action |
|---|---|---|
| HEALTHY | alive + progress evidence current | Run/Continue, Pause |
| SLOW | 30s abnormal heartbeat/UI stagnation warning | Inspect / Quick check |
| STALLED | active job with no progress/evidence for 2m | Thử khôi phục an toàn |
| RECOVERING | bounded recovery step active | No duplicate Run/Continue |
| BLOCKED | auth/CAPTCHA/security/rate-limit/session uncertainty or unsafe recovery | Inspect / Safe Close when terminal |

## Required telemetry labels
Show lastHeartbeatAt, lastUiStateChangeAt, lastJobEvidenceAt, currentJobId, uiBusy, controller/bridge/session and auth/security/rate-limit state. Display elapsed no-progress time and last recovery timestamp.

## Recovery presentation
- Recovery is one step at a time.
- Never offer a client-side bypass for AUTH, CAPTCHA, RATE_LIMIT/429, security warning, or session mismatch.
- During RECOVERING disable duplicate dispatch controls.
- Show bounded retry count and cooldown when supplied by authoritative API.
- Every recovery result exposes an audit/evidence reference when available.

## Fail-closed rules
Unknown, stale, mismatched, or missing authoritative state => BLOCKED/unavailable. Never render ONLINE from local heartbeat alone. Safe Close remains unavailable while active non-terminal mutation exists.

## Accessibility
Health state must be represented by text + icon/shape + accessible name. Do not use color as the sole signal. Announce transitions to STALLED/RECOVERING/BLOCKED through the accessible status region.
