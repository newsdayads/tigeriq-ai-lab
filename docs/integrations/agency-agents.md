# Agency Agents — pinned read-only catalog for TigerIQ Core

- Upstream: https://github.com/msitarzewski/agency-agents
- Pinned commit: `b37b5bb33b78f2c1d6567d98e25ca818e3259219`
- License: MIT, copyright (c) 2025 AgentLand Contributors, see upstream LICENSE.
- PC01 catalog: `D:\TigerIQ\Sources\agency-agents` (detached pinned checkout, source only; no upstream installer scripts run).
- Installation receipt: `JOB-MCP-04e86a01-9779-468a-a8d6-8cce18e2f870`; 330 Markdown sources / 384 tracked files, clean checkout.
- Source audit: upstream README, SECURITY.md, LICENSE, scripts/install.sh (review only), 4 role definition files. The shell installer can write/delete many tool profiles and is **not authorized to run** here.
- Adapted source roles: Senior Project Manager, Backend Architect, Evidence Collector, Reality Checker. Only these 4 SHA-verified files may provide bounded, curated reference hints to existing ACTIVE TigerIQ skills.
- Runtime bridge: `apps/tigeriq-core/agency-agent-reference.mjs` → existing `skill-loader.mjs` → Core job prompt. No second registry, job queue, worker lease, auto-spawn, or permission expansion.
- Fail-closed: missing catalog, non-detached or different HEAD, or mismatched file blob => no external hints. Generic Core skill loading remains functional. No floating update.
- Not accepted by source/CI alone: agent availability, user-facing product completion, Animal City E2E. Success needs real job result and independent existing gate.
