# Domain Skill Coverage Matrix

Work Order: #4382  
Parent: #4377  
Source of truth: `docs/skills/registry.yaml` on this branch.

This matrix records reusable skill coverage without inventing domain capability. "Partial" means TigerIQ has reusable supporting skills, but domain-specific execution remains an explicit gap.

| Domain | Coverage | Reused ACTIVE skills | Explicit gap | Disposition | Reason / next action |
|---|---|---|---|---|---|
| Engineering / Coding | Covered | spec-first-tdd; minimal-change-output; automated-code-review-gate; isolated-parallel-execution | None material for current scope | KEEP | Existing ACTIVE chain covers spec, implementation discipline, review, and isolated execution. |
| Design / UI | Covered | design-system-memory; image-to-ui-implementation; visual-quality-gate | None material for current scope | KEEP | Existing ACTIVE chain covers design memory, implementation, and visual verification. |
| Research / Intelligence | Covered | external-research-capability-routing; source-grounded-knowledge-retrieval | None material for current scope | KEEP | External research is routed explicitly and claims remain source-grounded. |
| Documents / Knowledge | Covered | document-normalization-ingest; source-grounded-knowledge-retrieval; context-budget-compaction | Binary conversion still depends on an approved converter when required | IMPROVE | Keep current contract fail-closed; improve only when a bounded converter path has real evidence. |
| Finance | Partial | document-normalization-ingest; source-grounded-knowledge-retrieval; context-budget-compaction; role-separated-execution | No ACTIVE finance-specific calculation/modeling/accounting execution skill | NEW | Create a finance execution skill only after a real finance workflow provides trigger/output/acceptance evidence; do not infer financial authority from generic skills. |
| Sales / Marketing | Partial | external-research-capability-routing; source-grounded-knowledge-retrieval; document-normalization-ingest; role-separated-execution | No ACTIVE sales/marketing-specific campaign/CRM execution skill | NEW | Create a sales/marketing execution skill only from real recurring work with measured acceptance; no CRM or publishing authority is implied. |
| Operations | Covered | context-budget-compaction; role-separated-execution; isolated-parallel-execution; source-grounded-knowledge-retrieval | Specialized operational mutations remain governed by their own capability gates | KEEP | Existing ACTIVE skills provide reusable coordination, isolation, context, and evidence retrieval without widening authority. |
| PC / Device / Automation | Partial | role-separated-execution; isolated-parallel-execution; context-budget-compaction | Device/runtime actions are capabilities, not a generic ACTIVE skill contract | IMPROVE | Keep execution under existing pc_operator/device contracts; add a skill only when repeated cross-device workflow evidence justifies one. |
| Review / QA | Covered | automated-code-review-gate; visual-quality-gate; role-separated-execution | None material for current scope | KEEP | Independent review and visual QA are already explicit ACTIVE contracts. |
| Governance / Safety | Partial | external-skill-security-gate; role-separated-execution; minimal-change-output | No single generic governance skill should absorb protected policy authority | REJECT | Reject a catch-all governance skill; keep protected authority in canonical policy/contracts and use narrow safety skills only. |

## Acceptance readback

- A1: 10 required domains are classified as Covered or Partial.
- A2: every material gap has a KEEP / IMPROVE / NEW / REJECT disposition with a reason.
- A3: this matrix introduces no new ACTIVE skill ID and duplicates no registry entry.
- A5: Finance, Sales/Marketing, and Operations each have a durable reusable pack under `docs/skills/domain-packs/`.
- Safety: no Production, paid, credential, security-boundary, destructive, or App Chrome authority is added.
