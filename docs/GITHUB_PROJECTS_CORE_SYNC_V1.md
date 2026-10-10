# Core → GitHub Projects metadata adapter V1

Target: [TIGERIQ — MASTER PORTFOLIO](https://github.com/users/newsdayads/projects/1), newsdayads, private.

## Deployment status

PREPARED_ADAPTER_ONLY. No runner, schedule, credential, permission change or Production activation is installed. Live synchronization is NOT verified. Browser authentication does not supply reusable API credentials. Existing CLI credential lacks project scope; Core credential scope remains unverified.

The module exports snapshotFromLiveStatus, planSync and syncProjects. Default mode is dry-run. An existing authorized caller must supply its token explicitly; token discovery/storage/renewal is outside this adapter. Missing token, missing verified project OAuth scope, missing viewerCanUpdate, public/wrong target, stale snapshot or incomplete schema fails closed. Fine-grained/App credentials without verifiable scope header also fail closed; no fallback broadens access.

## Source contract

Trusted server caller may use HTTPS https://tigeriq-ai-lab.vercel.app/api/live-status only after verifying transport, ok=true, liveConnected=true, mode=pc01-live, authority=PC01 live runtime, source.core=true and generatedAt within 120 seconds. workProjection must be pc01-live+github, stale=false, enumeration complete and verifiedAt within120seconds; fresh service timestamp never blesses stale GitHub work projection. transportVerified/verified are in-process caller attestations, not authentication and never accepted from external request input. No public endpoint accepts this envelope.

snapshotFromLiveStatus reads only identifiers and allowlisted metadata, joins open/active/recent by exact canonical URL, keeps open current metadata over older rows, inherits missing project IDs and uses existing Project content node IDs. Unknown project IDs are skipped; no title/body inference. No raw body, comment, logs, blocker detail, worker detail, credentials or PII are exported. Registered AI owner IDs must come from the current canonical Core registry supplied by the trusted caller. Do not infer personnel from names.

## Management projection

Writes only PROJECT, SUBPROJECT, native Status, AI OWNER, TARGET DATE, BLOCKER, EVIDENCE. PRIORITY, issue assignment and runtime control are never written. Status options match the real Project: CHƯA XÁC MINH, ĐANG XỬ LÝ, HOÀN TẤT, CHỜ, RÀ SOÁT, BỊ CHẶN. OWNER_GATE maps to BỊ CHẶN. Blocker is a fixed generic enum. Evidence is a canonical issue/PR/run/40-character commit URL in eight scoped repositories, without query/fragment. Driver issue366 is excluded.

Unverified priority is skipped. P0 projects receive only Status, BLOCKER, EVIDENCE reflecting verified Core; no AI OWNER, project remapping or target date writes on P0. This adapter cannot create issues, PRs, Project items, fields/options, assignments or P0 tasks. It can only update existing item fields, mapped by repository + issue/PR URL + number + content node ID. Duplicate identities, conflicting Core duplicates and mismatched IDs fail closed. Identical duplicate metadata folds once. Receipts suppress repeated identical writes; caller persists receipts only after success. Lost receipts merely repeat identical field values, never create work.

One direction: Core → Projects. GitHub-origin envelopes are rejected. No Project event updates Core or its queue/leases. Each write revalidates target privacy, permission and snapshot freshness. Writes are serial, bounded to100field patches, stop on first failure, never blind retry. A partial failure may leave some management fields updated; rerun dry-run and inspect before manual resumption. API errors return reason codes without provider/raw payload detail.

## Activation boundary

1. Review exact PR HEAD and CI/Queue Hygiene/Vercel.
2. Owner performs mandatory authentication for existing credential to access only target Project; do not request broad organizational or repository permissions.
3. Verify actual project capability and private target via identifier-only API reads; run dry-run against fresh authoritative Core snapshot and real item inventory.
4. Inspect sanitized plan and scope; one writer applies bounded existing-item updates.
5. Verify real views/items and idempotent subsequent run. Record Project URL, HEAD, counts and evidence in issue4640.

Until steps2–5 have evidence, report sync blocked by authorization, not deployed or complete. No automatic Production deployment is authorized by this document.

GitHub API references: [Projects GraphQL reference](https://docs.github.com/en/graphql/reference/projects), [Using API to manage Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects).
