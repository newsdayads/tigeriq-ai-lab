# Skill Effectiveness Tracking

This contract records **verified real-job outcomes** for ACTIVE skills and derives bounded effectiveness signals. Durable Core events remain the evidence source; the module does not create a new database or promotion authority.

## Contract

1. **USE** — a real job loads an ACTIVE skill through the existing skill loader.
2. **MEASURE** — terminal job outcome emits `SKILL_EFFECTIVENESS_OBSERVED` with `jobId + skillId + version + resource + outcome + evidence`.
3. **DEDUPE** — the durable event stream is checked by `jobId + skillId + version`; retry/replay does not count twice.
4. **SIGNALS** — usage, completed, failed/blocked, observed success ratio, duration when measured, recurring failure signatures, versions and evidence references.
5. **UNKNOWN** — missing verified evidence is not scored.
6. **PARK** — recurring identical failure evidence can surface `failureLoopState=PARKED`; it does not self-promote, self-retire or bypass routing policy.

## Safety

- Measurement never proves causality from one job.
- No chat text, credential, secret or private payload is stored for metrics.
- `retireSkill()` only clears the module's measurement cache; it does **not** mutate Skill Registry state.
- Promotion/demotion/retirement remains a separate evidence-gated governance path.
- App Chrome, Production, paid actions and credential/security boundaries are outside this contract.
