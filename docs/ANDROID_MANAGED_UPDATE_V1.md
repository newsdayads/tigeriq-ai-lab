# TigerIQ Android Managed Update V1

Canonical scope: #2949 - [P0][ANDROID] TigerIQ Mobile Worker — cụm AI Employee Android tự nhận việc, thực thi và tự cập nhật

## Decision

Production Android Worker updates use managed-device distribution. TigerIQ must not automate clicks on Google Play Protect or other Android security confirmation surfaces.

Preferred order:
1. Android Enterprise + Managed Google Play private app.
2. Approved Samsung enterprise MDM channel when the fleet is Samsung-only.
3. SELF_INSTALL only as DEV/fallback.

## Stable identity

- Package: ai.tigeriq.worker
- Signing certificate SHA-256: 63E027C013222139982B4F4FF43AFF8734EAC4B249FE85E94A3EADFDE19C8293
- Existing package/signing lineage must be preserved.

## Release contract

Core release manifest supports:
- installMode=MANAGED_PLAY
- installMode=MANAGED_MDM
- installMode=SELF_INSTALL

For managed modes, the Worker never launches PackageInstaller. It reports MANAGED_UPDATE_PENDING until the managed platform installs the target version. Heartbeat agentVersion is the acceptance evidence.

## Fleet acceptance

A release is complete only when each required device reports the target agentVersion through Core within the freshness window. Publish alone is not completion.

Required minimum dashboard/state:
- nodeId / employeeId
- lastSeenAt
- agentVersion
- targetVersion
- convergence state: UP_TO_DATE / UPDATE_PENDING / STALE

## Current migration

v0.26 remains SELF_INSTALL until S10 5G and Z Flip are enrolled into the chosen managed-device channel. Switching the production manifest to MANAGED_PLAY/MANAGED_MDM before enrollment is forbidden because it would strand updates.

Enrollment, enterprise ownership, KYC, paid licensing, factory reset, or destructive device re-provisioning remain Owner gates.
