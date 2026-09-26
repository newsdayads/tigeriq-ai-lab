# Capability-Aware Model Routing

## Trigger
Use when selecting an AI resource/model/provider for reasoning, review, research, or general execution.

## Rules
- Route by required capability, task difficulty, observed reliability, latency, quota and zero-out-of-pocket policy.
- Prefer a lighter eligible resource when it can meet acceptance; reserve stronger resources for harder reasoning/debugging.
- Preserve reviewer independence for review tasks.
- Respect cooldown/rate-limit/availability evidence and fail over only within existing authorization.
- Never select a paid route merely because it is stronger.

## Non-goals
This skill does not create credentials, enable paid services, or change provider security settings.
