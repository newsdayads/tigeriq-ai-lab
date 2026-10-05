# #3987 Impeccable delta audit

## Provenance
- Upstream: `pbakaus/impeccable`
- Pinned commit: `ece38d9904b8a619b3f77cab476eacad09c4fb11`
- License: Apache-2.0
- Intake mode: rule/detector concepts only; no package/framework installation and no executable upstream code copied.

## Existing TigerIQ design skills
| Existing skill | Responsibility | Delta decision |
|---|---|---|
| design-system-memory | Preserve approved visual language/tokens | KEEP |
| image-to-ui-implementation | Translate approved visual reference into minimal UI changes | KEEP |
| visual-quality-gate | Verify rendered UI against approved evidence | IMPROVE with deterministic detector evidence |

## KEEP / IMPROVE / REJECT
| Upstream concept | Decision | Reason |
|---|---|---|
| Deterministic mechanical scan separate from design judgment | KEEP | Matches TigerIQ rendered-evidence gate and reduces subjective PASS claims. |
| Gradient-text detector | IMPROVE | Add as hard mechanical rule only when both gradient background and text clipping are present. |
| Glow-shadow detector | IMPROVE | Add as advisory with status/focus/design-contract guards. |
| Side-tab detector | IMPROVE | Add as advisory with geometry, chroma, content and semantic-context guards. |
| Full Impeccable CLI/hooks/install flow | REJECT | Would create parallel tooling/browser authority and package dependency. |
| Product-wide critique scoring/LLM persona review | REJECT | Subjective and overlaps existing visual-quality-gate; keep human/LLM judgment separate from deterministic detector facts. |
| Automatic rule suppression/config mutation | REJECT | TigerIQ keeps evidence/promotion and design authority in existing scoped contracts. |

## Fixtures
### gradient-text
- BAD: text element with `linear-gradient(...)` + `background-clip:text` => finding.
- GOOD: same gradient on decorative non-text surface => no finding.
- GOOD: solid-color text => no finding.

### glow-shadow
- BAD: default card `box-shadow:0 0 48px ...` => advisory.
- GOOD: 1-4px focus/status ring => no finding.
- GOOD: documented tiny live-status glow => guarded exception.

### side-tab
- BAD: empty 4px chromatic child hugging card left edge and spanning >=50% host height => advisory.
- GOOD: progress/slider/tab/status context => no finding.
- GOOD: neutral stripe or stripe containing text => no finding.

## False-hard-fail policy
Only `gradient-text` is hard in this delta, and only after both trigger clauses match. Glow and side-tab are advisory, so valid branded/status patterns cannot create a new hard failure without separate approved-design evidence.
