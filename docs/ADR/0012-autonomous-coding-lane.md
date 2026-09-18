# ADR 0012 — Autonomous Coding Lane

Status: Accepted / Implemented
Date: 2026-09-12 (Updated 2026-09-19 for Phase A Blueprint)

Decision: Repository coding is performed by a separate TigerIQ Coding Lane service, not by the Core/API Health process. The lane uses API AI employees for planning, implementation, and independent review; all source changes occur through isolated GitHub branches and PRs adhering strictly to zero-cost, owner-direct parameters.

Rationale: This preserves the GitHub-only engineering boundary, keeps PC01 out of local source editing/builds, and allows Core `:8795` to remain online while coding automation evolves independently.

Merge authority remains GitHub branch protection. The lane must not bypass failed CI, review, credential/security boundaries, paid-service restrictions, or protected paths (such as `apps/worker-utility/` or `apps/tigeriq-core/manager-json.mjs` unless explicitly authorized by separate Work Orders).
