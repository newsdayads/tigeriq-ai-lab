# Image-to-UI Implementation

## Identity
- ID: image-to-ui-implementation
- Version: 1.0.0
- State: ACTIVE
- Target: ui-implementation
- Provenance: registry.yaml; #976

## Trigger
Use when an approved screenshot, mockup, or reference image must be translated into a web/app interface or an existing interface must be corrected toward that reference.

## Input
- Approved image/mockup reference.
- Existing UI implementation and behavior.
- Scoped DESIGN.md/design contract when present.
- Explicit acceptance for responsive/interaction states when required.

## Steps
1. Identify structure, alignment, hierarchy, component boundaries, repeated patterns, states, and measurable geometry.
2. Reuse the scoped design contract and surface conflicts rather than silently choosing.
3. Map observations to the smallest implementation changes.
4. Preserve behavior/data unless behavior change is in scope.
5. Keep a traceable reference-element -> implementation-element -> verification mapping.
6. Hand off to visual-quality-gate after implementation.

## Tools / Output
Use the existing UI implementation toolchain. Output minimal traceable UI changes plus mapping and verification evidence.

## Acceptance
- Implemented UI is traceable to approved reference evidence.
- Unseen/ambiguous behavior is not invented.
- Unrelated runtime/control-plane code remains unchanged.

## Evidence
- #976 - AI Design Intelligence skills.
- Approved screenshot/mockup/reference plus implementation/verification artifacts.

## Fallback
For ambiguous or invisible behavior, preserve current behavior or require separate acceptance evidence.

## Safety
Do not install third-party packages, bypass review, modify unrelated runtime/control-plane code, or copy protected assets outside authorized use.

## Non-goals
This skill is not a license to clone copyrighted assets verbatim and does not replace visual-quality verification.
