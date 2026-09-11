# ADR 0012 — Autonomous Coding Lane

Status: Proposed / implementation branch
Date: 2026-09-12

Decision: repository coding is performed by a separate TigerIQ Coding Lane service, not by the Core/API Health process. The lane uses API AI employees for planning, implementation and independent review; all source changes occur through isolated GitHub branches and PRs.

Rationale: this preserves the GitHub-only engineering boundary, keeps PC01 out of local source editing/builds, and allows Core `:8795` to remain online while coding automation evolves independently.

Merge authority remains GitHub branch protection. The lane must not bypass failed CI, review, credential/security boundaries, paid-service restrictions, or protected paths.
