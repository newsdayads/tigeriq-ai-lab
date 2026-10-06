# External Skill Security Gate

## Identity
- ID: external-skill-security-gate
- Version: 1.0.0
- State: ACTIVE
- Target: skill-intake
- Provenance: registry.yaml; #909; PR #1173; merge e4d4d1a977332bb53a53137748e786f5e41b0100

## Trigger
Use before any external skill, plugin, package, or reusable automation is allowed executable use inside TigerIQ.

## Input
- Pinned provenance and version.
- License/status evidence when applicable.
- Installer/package-script audit.
- Declared capabilities and required permissions.

## Steps
1. Verify provenance and pin the exact version/source.
2. Audit installer and package scripts before execution.
3. Classify capabilities such as READ, WRITE, RUN_COMMAND, NETWORK, and CONFIG_PERMISSION_CHANGE.
4. Validate the security contract/schema.
5. Default-deny executable use when required evidence is incomplete.

## Tools / Output
Use the existing skill-intake validation source and schema. Output a machine-readable allow/deny decision with evidence and exact gaps. This skill does not install anything.

## Acceptance
- Complete trusted/reference fixtures pass.
- Incomplete or untrusted fixtures deny executable use.
- No external installer or package script is executed merely to evaluate the skill.

## Evidence
- #909 - Activate External Skill Security Gate.
- PR #1173 - External Skill Security Gate Contract.
- docs/skills/external-skill-security-gate.mjs
- docs/skills/external-skill-security-gate.schema.json

## Fallback
Missing, ambiguous, or unverifiable metadata returns deny/block with the exact missing evidence and next condition.

## Safety
Popularity is not trust evidence. No floating-latest auto-update, credential/security/permission change, paid action, or Production mutation is authorized.

## Non-goals
This skill does not install, enable, or auto-promote external skills.
