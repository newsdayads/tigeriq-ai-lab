# TIGERIQ DYNAMIC REGISTRY V1

Status: P0 candidate / off-MAIN
Source issue: #335
Stable sync: 2026-09-05 after command-3 Acceptance E

## Canonical locators
- `docs/registry/COMMAND_REGISTRY.json`
- `docs/registry/AI_EMPLOYEE_REGISTRY.json`

## Generic numeric command resolver
When a NEW CHAT contains only an integer `N`:
1. Load Bootstrap core safety/source contract.
2. Read the current dynamic command registry from the canonical locator.
3. Resolve the exact string key for `N`.
4. Require `enabled=true` and a matching active employee in the AI Employee Registry.
5. Read current authoritative state/queue plus ownership/lease/resource-lock evidence before any mutation.
6. Execute only inside the employee's `max_authority_envelope`.
7. Unknown, disabled, malformed, missing-employee, inactive-employee, or unreadable registry state fails closed as `COMMAND_UNREGISTERED` / `COMMAND_REGISTRY_UNAVAILABLE`; never infer semantics from chat history.

## Ownership invariants
- One active owner per Work Order/resource scope.
- Foreign active lease => SKIP that scope.
- Takeover requires the registry policy plus current checkpoint/evidence and must be idempotent.
- `OWNER_HOLD` blocks takeover.
- Registry entries never override core Production, financial, credential/security, irreversible, privacy, or physical-device authorization boundaries.

## Current stable mappings
- `1` -> `NV01` -> Minh — Thực thi trực tiếp — enabled.
- `2` -> `NV02` -> Khoa — Vận hành tự động — enabled.
- `3` -> `NV03` -> Huy — AI PC01 / Kỹ sư Hệ thống Local — disabled regression record.

Legacy IDs `NV-EXEC-01`, `NV-OPS-01`, `NV-SYS-01` are retained only for historical/evidence lookup. New authoritative writes use `NV01`, `NV02`, `NV03`.

## Regression result
1. NEW CHAT `1` resolved Minh from dynamic registry — ĐẠT.
2. NEW CHAT `2` resolved Khoa from dynamic registry — ĐẠT.
3. NEW CHAT `3` while unregistered failed closed — ĐẠT.
4. Temporary command `3` was enabled dynamically and NEW CHAT `3` resolved Huy in `REGRESSION_ONLY` / `test_only_no_runtime_mutation` mode — ĐẠT.
5. Command `3` was disabled dynamically and NEW CHAT `3` failed closed again as `COMMAND_UNREGISTERED` — ĐẠT.
6. No Project Source replacement was required for enable/disable/remap of command `3`.

## Dynamic-change rule
Adding/removing/disabling a normal command or employee, changing UI labels, runtime binding, lease timeout, role/capability inside the existing authority envelope, or remapping command -> employee is a dynamic registry change and does not require Project Source replacement.

Project Source replacement is required only when the generic resolver/source locator/core safety contract itself changes.

## Safety
This registry does not authorize MAIN/Production, paid/financial commitments, credential/security-boundary changes, irreversible actions, or physical reboot/device actions.
