# ADR — One Auto Worker, Registry-Driven Multi-Employee Runtime

Decision: evolve the proven V13.4.10 extension incrementally into one V14 scheduler rather than create multiple extensions.

Rationale: preserves physical window/archive/submit/readiness baselines, prevents duplicated browser permissions/state, and centralizes lease/governor/preempt semantics. Employee identities/commands are data; scheduler algorithms operate on registry records.

Invariant: one resource -> one active lease owner. Owner/Vy/NV01 foreground precedence can preempt AUTO only at a safe checkpoint. Release gates remain outside the runtime authority envelope.

Registry adapter: packaged seed is the last verified dynamic Registry snapshot at build time; runtime stores it separately from code and accepts validated registry replacement through `TIQ140_APPLY_REGISTRY`. No GitHub host permission is added in this candidate; authoritative Registry updates are mirrored through the existing control/update path without widening extension network authority.