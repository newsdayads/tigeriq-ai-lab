# TIGERIQ DYNAMIC REGISTRY V1

Status: P0 candidate / off-MAIN
Source issue: #335

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

## Current authoritative mappings
- `1` -> `NV-EXEC-01` -> Minh — Thực thi trực tiếp.
- `2` -> `NV-OPS-01` -> Khoa — Vận hành tự động.

## Dynamic-change rule
Adding/removing/disabling a normal command or employee, changing UI labels, runtime binding, lease timeout, role/capability inside the existing authority envelope, or remapping command -> employee is a dynamic registry change and does not require Project Source replacement.

Project Source replacement is required only when the generic resolver/source locator/core safety contract itself changes.

## Regression contract
After the one-time Bootstrap migration to this resolver:
1. NEW CHAT `1` resolves Minh from registry.
2. NEW CHAT `2` resolves Khoa from registry.
3. Add a temporary enabled command `3` + test employee in registry; NEW CHAT `3` resolves it without Project Source change.
4. Disable/remove test `3`; NEW CHAT `3` fails closed without Project Source change.
5. No MAIN/Production/paid/credential/security/irreversible action is authorized by this registry.
