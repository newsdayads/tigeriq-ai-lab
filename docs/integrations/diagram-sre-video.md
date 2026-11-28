# GH-5821 — Selective Diagram Design / OpenSRE / HyperFrames adoption

Status: CANDIDATE_REFERENCE_ONLY; no new skill ID, registry, scheduler, model, service or authority.
Existing ACTIVE skills retain their identities, triggers, versions and security gates. This document proposes optional references, not a promotion or runtime activation.

## Provenance and security decisions

- Diagram Design [795eec47fd376e5dda0b9e056a49520060cd2f13](https://github.com/cathrynlavery/diagram-design/tree/795eec47fd376e5dda0b9e056a49520060cd2f13), MIT metadata. Reviewed SKILL.md blob 3b41b0f61db73b0e0a4505439b827bb2cd412e51, architecture reference 139082e743dfa692f064897d2a109c35b94e9a56 and privacy 6284846d63b2c6b023522dbc0319642dc2425bb0. Reference-only: no global skill installation, profile store, external font loads or arbitrary HTML/script from external inputs.
- OpenSRE [d3d0af888005dd6ed29cb5a5ec7223c6150b1fdf](https://github.com/Tracer-Cloud/opensre/tree/d3d0af888005dd6ed29cb5a5ec7223c6150b1fdf), Apache-2.0 metadata; reviewed CI repair docs ca5b016aaab612403bfd336ac7da4e59a3de248b and loop docs 5e45fb48085ee56fb2facafda16abd3869e07b72. Public alpha; no installer, hosted model, credentials, daemon, direct pushes or repair loop imported.
- HyperFrames [fd126e00a0d18c434acdbcb07d1760b4428ececf](https://github.com/heygen-com/hyperframes/tree/fd126e00a0d18c434acdbcb07d1760b4428ececf), Apache-2.0 metadata; skill 729e73521abd66b786b8a7bafa318f0d47d511eb and CLI package 2bbbc33e731c6fad7d008795f1a0f6da71fadc02. Source CLI declares v0.9.105; not an installed/published package version claim. No usage beacon, account, paid model, external assets or npx execution. Full bytes/dependencies review incomplete; ffmpeg/ffprobe not found on PC01 PATH (JOB-MCP-12c7093d-a68b-43d8-b619-6cc267a8efdf). Do not assume missing everywhere.

## Reusable methods for existing skills (candidate)

### design-system-memory / visual-quality-gate
Use diagrams only when topology, flow or trust boundaries convey information better than text. Preserve approved project tokens, prefer 4–9 meaningful nodes, one focal node, a consistent primary direction, orthogonal connectors, and explicit trust boundaries. Render local SVG without external fonts/URLs or scripts; verify geometry, labels, clipping, contrast and actual raster at target viewport. Label proposed topology as proposed. A static picture never proves runtime behavior.

### spec-first-tdd / learn-from-failure / automated-code-review-gate
For an incident record exact surface, symptom, revision and timestamp/receipt; separate service liveness from the affected operation. Rank falsifiable hypotheses, perform one bounded discriminating probe, correlate same scope/revision, and retain evidence. Do not infer causality from temporal coincidence or temporary recovery. No unchanged retries or auto-repair on protected boundaries; use existing self-audit, failure-learning, writer, CI and release gates. A repeated signature is a candidate, not a learned rule or root cause.

### visual-quality-gate (video)
Keep an editable authored HTML timeline; stable IDs, explicit duration/start/end, deterministic frame-time input, local assets, no remote requests. Check scene coverage and overlap, visually inspect sampled frames, verify encoder/container/size/duration/frame count, compare repeated frame renders. If deterministic output fails, do not claim it passed. Existing local rendering tools first; no new daemon, hosted account or payment. HyperFrames runtime remains default-deny pending security review and real canary.

## Pilot results (actual, narrow)

- SVG: locally authored architecture SVG rendered via offline Chromium, 960x540, zero external requests, raster visually inspected. SVG SHA256 f70acdd997df34ff0d61c14e31146abaf0f1b5839e4e33418e3ea5411a530743; PNG 512cb1e3f4bccba95c0dda3168dfd790522f2affaab2bed0061aad5aa8b961db. Sandbox files, not repository artifacts.
- Incident: existing #5820 reports two previous successful UI enumerations after relaunch; current fresh PC01 Core online JOB-MCP-a80d4b55-ae99-4c85-8571-7eeae52c0801, pad_windows timeout JOB-MCP-24e27dca-2d40-4e72-94b4-97e1e1721885, broker available JOB-MCP-034ffb1a-252f-4d3b-88a6-87ed40dfdfc8, pending UI=0, Agent Desktop 1.3.1 and Seelen responding JOB-MCP-0b70e19f-1292-4d20-ab1c-23629ffcbaae. Recurrent failure, cause unknown; not a system-wide outage and not proof Seelen caused it. No restart or mutation. Durable PC01 evidence JOB-MCP-217b0c1c-00ef-4dfd-9a23-c8b25d219b51 SHA256 7cc49e3f4805bbcdd377a778d08410b2a13d55b45aa9236181f563299981b955.
- Video: independent local HTML/Chromium/ffmpeg method, 72/72 frame scene-selection assertions, no external requests, ffprobe confirmed H.264 960x540 at 12 fps and 6 seconds. Repeat-frame pixel equality FALSE after layout/settling changes. Not a HyperFrames CLI test, not deterministic acceptance, not PC01 deployment. HTML SHA256 dc58a8f7f606714bbbe81df3a1e918857499518853cd85ca618318d5bd422c55; MP4 e2b391ef359a3d80b42076b40716cbe29eb9ae09683c79cd3cf8d2d6e0d96431. Sandbox files only.
- No additional paid cost incurred. No source-level changes are live until guarded merge and relevant runtime acceptance.

## Next
1. Existing review and exact-head CI; then validate reference usage on actual tasks, not just registry text.
2. For incident, a bounded timed native enumeration under authorized conditions; no claim of root cause or fix. Keep existing Seelen running unless authorized recovery demands otherwise.
3. Video: resolve reproducibility mismatch, audit exact local renderer/dependencies, test actual HyperFrames package isolated without paid/network features. PC01 only for approved artifact/runtime, not ordinary repo coding.
