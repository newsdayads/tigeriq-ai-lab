# TigerIQ Auto Worker V13.4.10 — Physical Archive-before-close fix

Parent: #306
Status: BUILD/STATIC/MOCK PASS — PHYSICAL CHROME RETEST PENDING

## Physical finding
At cycle end V13.4.9 showed `LƯU TRỮ` but only wrote a local snapshot, then verified DOM stability and closed the managed window. It did **not** execute ChatGPT's real **Lưu trữ / Archive** command.

## Root cause
The tail pipeline mislabeled `saveSnapshot(...:archive)` as `LƯU TRỮ`; no DOM path existed to open the conversation menu and select Archive. Therefore a cycle could close with the chat still active in project history.

## V13.4.10 correction
- Create local pre-archive snapshot as safety backup; explicitly label it snapshot, not Archive.
- Execute real ChatGPT conversation **Lưu trữ / Archive** UI action.
- Prefer the current conversation row (URL token `/c/<id>`), with bounded fallback menu candidates; support Vietnamese `Lưu trữ` and English `Archive`.
- Accept Archive only with bounded evidence: URL left the conversation, current history row disappeared, or archive toast appeared.
- Maximum 2 Archive attempts, 8s ACK each.
- If Archive cannot be confirmed: `BỊ CHẶN LƯU TRỮ`, keep window open, do **not** close cycle.
- Verify local snapshot readback + Archive ACK, persist `tiq134LastArchiveEvidence`, then close.
- Background independently refuses `CYCLE_FINISHED` unless both `archived=true` and `verified=true`.

## Locked baselines — DO NOT REWORK
- Window **504×834 / Top5 / Right5 = PHYSICAL PASS / LOCKED**.
- Tiger icon/countdown enlarged.
- Status panel default hidden; Tiger toggles it.
- Fast composer recovery 12s/max3.
- Submit reconcile max2 + explicit next-turn ACK + 20s self-heal.
- Exact Project, Pause/Stop authority, anti-duplicate, lifecycle/watchdog retained.
- Installer does not auto-open Chrome.

## Evidence
- Archive/tail regression lock: **20/20 PASS**.
- Node syntax background/runtime/popup/installer: **PASS**.
- Mock update V13.4.9 → V13.4.10: **PASS**, extension key preserved.
- CMD embedded installer payload equals tested installer source: **PASS**.

## Physical gate
At real cycle end observe in order: **local backup → LƯU TRỮ ĐOẠN CHAT → XÁC MINH LƯU TRỮ → ĐÓNG CHU KỲ**. The prior conversation must disappear from active project history before the managed window closes.

## Release hashes
- Installer SHA-256: `1da942cf5b6038b77c8dc39c4fa75cf967d90e77e65c43ba5f1cf1d7cdc0b6bf`
- Source/tests ZIP SHA-256: `61cfe6ecde5dedfce9800bf6f8e87cb708e7dd0f048be5bb44e99c96ba72aee6`
- Runtime SHA-256: `5adc5a2472f04e38fa6fa4da928df9bfccbc7a69a907a3202f0bdf8119d27884`
- Background SHA-256: `58b2fe23ac30feffaea0be86e2dfed89ae3c8870c8bb6ccb182868f21f078b50`
- Installer source SHA-256: `abd2001e4cad353594daeb5bf905fa70ea576ffd58fd79c8a5821ccf37ea13b9`
