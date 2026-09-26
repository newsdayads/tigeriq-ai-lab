# Image-to-UI Implementation

Status: ACTIVE
Issue: #976 - AI Design Intelligence skills
Target: ui-implementation

## Apply when
Use when an approved screenshot, mockup, or reference image must be translated into a web/app interface or an existing interface must be corrected toward that reference.

## Rules
- Start from the reference: identify structure, alignment, visual hierarchy, component boundaries, repeated patterns, states, and measurable geometry before editing code.
- Reuse the scoped DESIGN.md/design contract when present; if the image conflicts with it, surface the conflict instead of silently choosing.
- Map visual observations to the smallest implementation changes that satisfy the reference; avoid unrelated rewrites.
- Preserve behavior and data while changing presentation unless behavior change is explicitly in scope.
- Maintain a traceable mapping: reference element -> implementation element -> verification evidence.
- For ambiguous or invisible behavior, do not guess. Keep the current behavior or require separate acceptance evidence.
- Hand off to the visual-quality-gate after implementation.

## Non-goals
This skill is not a license to clone copyrighted assets verbatim, install third-party packages, bypass review, or modify unrelated runtime/control-plane code.
